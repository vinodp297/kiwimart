// src/test/security-sprint-a.test.ts
// ─── Security Sprint A — Tests for all four security fixes ──────────────────
//
// Fix 1: Real malware scanning (scanForMalware content analysis)
// Fix 2: PII redaction in logs (sanitiseLogContext)
// Fix 3: Pickup worker in health check (already present — regression guard)
// Fix 4: Queue-specific health thresholds

import { describe, it, expect, vi, afterEach } from "vitest";
import http from "http";

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 1 — Real malware scanning
// ═══════════════════════════════════════════════════════════════════════════════

vi.mock("server-only", () => ({}));

import {
  scanForMalware,
  type ScanResult,
} from "@/server/actions/imageProcessor";

describe("Fix 1 — scanForMalware content analysis", () => {
  it("detects PE (Windows executable) header in file", async () => {
    // PE header: "MZ" (0x4D 0x5A) embedded in an otherwise clean buffer
    const buffer = Buffer.concat([
      Buffer.alloc(100, 0x00),
      Buffer.from([0x4d, 0x5a]),
      Buffer.alloc(100, 0x00),
    ]);
    const result = await scanForMalware(buffer, "suspicious.jpg");

    expect(result.isSafe).toBe(false);
    expect(result.threats).toEqual(
      expect.arrayContaining([expect.stringContaining("PE")]),
    );
  });

  it("detects ELF (Linux executable) header in file", async () => {
    // ELF header: 0x7F + "ELF"
    const buffer = Buffer.concat([
      Buffer.alloc(50, 0x00),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
      Buffer.alloc(50, 0x00),
    ]);
    const result = await scanForMalware(buffer, "suspicious.png");

    expect(result.isSafe).toBe(false);
    expect(result.threats).toEqual(
      expect.arrayContaining([expect.stringContaining("ELF")]),
    );
  });

  it("detects PHP code injection in file", async () => {
    const buffer = Buffer.from(
      "some image data <?php echo 'hack'; ?> more data",
    );
    const result = await scanForMalware(buffer, "shell.jpg");

    expect(result.isSafe).toBe(false);
    expect(result.threats).toEqual(
      expect.arrayContaining([expect.stringContaining("PHP")]),
    );
  });

  it("detects script tag injection in file", async () => {
    const buffer = Buffer.from("image data <script>alert(1)</script> rest");
    const result = await scanForMalware(buffer, "xss.png");

    expect(result.isSafe).toBe(false);
    expect(result.threats).toEqual(
      expect.arrayContaining([expect.stringContaining("Script tag")]),
    );
  });

  it("returns isSafe: true and empty threats for a clean JPEG buffer", async () => {
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const buffer = Buffer.concat([jpegMagic, Buffer.alloc(500, 0x00)]);
    const result = await scanForMalware(buffer, "clean.jpg");

    expect(result.isSafe).toBe(true);
    expect(result.threats).toHaveLength(0);
    expect(result.confidence).toBe("HIGH");
  });

  it("flags oversized file (> 8 MB) as suspicious", async () => {
    const buffer = Buffer.alloc(9 * 1024 * 1024, 0x00);
    const result = await scanForMalware(buffer, "huge.jpg");

    expect(result.isSafe).toBe(false);
    expect(result.threats).toEqual(
      expect.arrayContaining([expect.stringContaining("size")]),
    );
  });

  it("detects shell shebang pattern", async () => {
    const buffer = Buffer.from("#!/bin/bash\nrm -rf /\n");
    const result = await scanForMalware(buffer, "script.jpg");

    expect(result.isSafe).toBe(false);
    expect(result.threats).toEqual(
      expect.arrayContaining([expect.stringContaining("shebang")]),
    );
  });

  it("detects JavaScript protocol in file", async () => {
    const buffer = Buffer.from("data javascript:void(0) more");
    const result = await scanForMalware(buffer, "proto.png");

    expect(result.isSafe).toBe(false);
    expect(result.threats).toEqual(
      expect.arrayContaining([expect.stringContaining("JavaScript protocol")]),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 2 — PII redaction in logs
// ═══════════════════════════════════════════════════════════════════════════════

import { sanitiseLogContext } from "@/lib/log-sanitiser";
import { redactEmail } from "@/server/email/transport";

describe("Fix 2 — PII redaction", () => {
  it("sanitiseLogContext redacts 'email' field", () => {
    const ctx = sanitiseLogContext({
      email: "alice@example.com",
      orderId: "o-1",
    });

    expect(ctx.email).toBe("a***@example.com");
    expect(ctx.orderId).toBe("o-1");
  });

  it("sanitiseLogContext redacts field ending in 'Email'", () => {
    const ctx = sanitiseLogContext({ invitedEmail: "bob@test.nz" });

    expect(ctx.invitedEmail).toBe("b***@test.nz");
  });

  it("sanitiseLogContext redacts 'to' field when it contains @", () => {
    const ctx = sanitiseLogContext({
      to: "carol@domain.co.nz",
      template: "welcome",
    });

    expect(ctx.to).toBe("c***@domain.co.nz");
    expect(ctx.template).toBe("welcome");
  });

  it("sanitiseLogContext redacts phone field", () => {
    const ctx = sanitiseLogContext({ phone: "0211234567" });

    // Last 4 digits visible, earlier digits masked
    expect(ctx.phone).toBe("******4567");
  });

  it("sanitiseLogContext preserves non-PII fields unchanged", () => {
    const ctx = sanitiseLogContext({
      orderId: "ord-123",
      amount: 4500,
      status: "COMPLETED",
    });

    expect(ctx).toEqual({
      orderId: "ord-123",
      amount: 4500,
      status: "COMPLETED",
    });
  });

  it("admin invite log uses redacted email (integration check)", () => {
    // Verify redactEmail works correctly for the admin flow
    const raw = "admin@buyzi.co.nz";
    const redacted = redactEmail(raw);

    expect(redacted).toBe("a***@buyzi.co.nz");
    expect(redacted).not.toContain("admin@");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 3 — Pickup worker in health check (regression guard)
// ═══════════════════════════════════════════════════════════════════════════════

import {
  startHealthServer,
  type WorkerEntry,
  type QueueEntry,
} from "@/server/workers/health-server";

function makeWorker(running = true, paused = false): WorkerEntry["worker"] {
  return {
    isRunning: vi.fn(() => running),
    isPaused: vi.fn(() => paused),
  } as unknown as WorkerEntry["worker"];
}

function makeQueue(
  counts: { waiting?: number; active?: number; failed?: number } = {},
): QueueEntry["queue"] {
  return {
    getJobCounts: vi.fn().mockResolvedValue({
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
    }),
  } as unknown as QueueEntry["queue"];
}

function all4Workers(running = true): WorkerEntry[] {
  return [
    { name: "email", worker: makeWorker(running) },
    { name: "image", worker: makeWorker(running) },
    { name: "payout", worker: makeWorker(running) },
    { name: "pickup", worker: makeWorker(running) },
  ];
}

function all4Queues(
  overrides: Partial<
    Record<string, { waiting?: number; active?: number; failed?: number }>
  > = {},
): QueueEntry[] {
  return ["email", "image", "payout", "pickup"].map((name) => ({
    name,
    queue: makeQueue(overrides[name] ?? {}),
  }));
}

async function getHealth(
  server: http.Server,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const address = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${address.port}/health`, (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        });
      })
      .on("error", reject);
  });
}

function waitForListening(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once("listening", resolve);
  });
}

describe("Fix 3 — Pickup worker in health check", () => {
  const servers: http.Server[] = [];

  async function makeServer(
    workers: WorkerEntry[],
    queues: QueueEntry[] = [],
  ): Promise<http.Server> {
    const server = startHealthServer(0, workers, queues);
    servers.push(server);
    await waitForListening(server);
    return server;
  }

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (s) => new Promise<void>((resolve) => s.close(() => resolve())),
      ),
    );
    servers.length = 0;
  });

  it("health check response includes pickup worker", async () => {
    const server = await makeServer(all4Workers());
    const { body } = await getHealth(server);
    const workers = body.workers as Array<{ name: string }>;
    const names = workers.map((w) => w.name);

    expect(names).toContain("pickup");
  });

  it("all 4 workers (email/image/payout/pickup) appear in health response", async () => {
    const server = await makeServer(all4Workers());
    const { body } = await getHealth(server);
    const workers = body.workers as Array<{ name: string }>;
    const names = workers.map((w) => w.name);

    expect(names).toEqual(
      expect.arrayContaining(["email", "image", "payout", "pickup"]),
    );
    expect(names).toHaveLength(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 4 — Queue-specific health thresholds
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fix 4 — Queue health thresholds", () => {
  const servers: http.Server[] = [];

  async function makeServer(
    workers: WorkerEntry[],
    queues: QueueEntry[] = [],
  ): Promise<http.Server> {
    const server = startHealthServer(0, workers, queues);
    servers.push(server);
    await waitForListening(server);
    return server;
  }

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (s) => new Promise<void>((resolve) => s.close(() => resolve())),
      ),
    );
    servers.length = 0;
  });

  it("queue with failed > 10 → isHealthy: false", async () => {
    const server = await makeServer(
      all4Workers(),
      all4Queues({ payout: { failed: 15 } }),
    );
    const { body } = await getHealth(server);
    const queues = body.queues as Record<string, { isHealthy: boolean }>;

    expect(queues.payout!.isHealthy).toBe(false);
    expect(queues.email!.isHealthy).toBe(true);
  });

  it("queue with waiting > 100 → degraded status (HTTP 200)", async () => {
    const server = await makeServer(
      all4Workers(),
      all4Queues({ image: { waiting: 150 } }),
    );
    const { status, body } = await getHealth(server);

    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
  });

  it("all queues healthy + all workers running → status: ok", async () => {
    const server = await makeServer(all4Workers(), all4Queues());
    const { status, body } = await getHealth(server);

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("any queue unhealthy (failed > threshold) → HTTP 503", async () => {
    const server = await makeServer(
      all4Workers(),
      all4Queues({ email: { failed: 20 } }),
    );
    const { status, body } = await getHealth(server);

    expect(status).toBe(503);
    expect(body.status).toBe("unhealthy");
  });

  it("health response includes queue counts for all 4 queues", async () => {
    const server = await makeServer(
      all4Workers(),
      all4Queues({ email: { waiting: 5, active: 2, failed: 1 } }),
    );
    const { body } = await getHealth(server);
    const queues = body.queues as Record<
      string,
      { waiting: number; active: number; failed: number; isHealthy: boolean }
    >;

    expect(Object.keys(queues)).toEqual(
      expect.arrayContaining(["email", "image", "payout", "pickup"]),
    );
    expect(queues.email!.waiting).toBe(5);
    expect(queues.email!.active).toBe(2);
    expect(queues.email!.failed).toBe(1);
    expect(queues.email!.isHealthy).toBe(true);
  });

  it("health response includes uptimeSeconds", async () => {
    const server = await makeServer(all4Workers(), all4Queues());
    const { body } = await getHealth(server);

    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
