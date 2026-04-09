// src/test/worker-health.test.ts
// ─── Tests: worker health check server ───────────────────────────────────────
// Verifies that /health returns 200 only when all workers are running,
// and 503 when any worker has stopped or is paused.

import { describe, it, expect, vi, afterEach } from "vitest";
import http from "http";
import { startHealthServer } from "@/server/workers/health-server";
import type { WorkerEntry } from "@/server/workers/health-server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWorker(running = true, paused = false): WorkerEntry["worker"] {
  return {
    isRunning: vi.fn(() => running),
    isPaused: vi.fn(() => paused),
  } as unknown as WorkerEntry["worker"];
}

async function getHealth(
  server: http.Server,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const address = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${address.port}/health`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("startHealthServer", () => {
  const servers: http.Server[] = [];

  async function makeServer(workers: WorkerEntry[]): Promise<http.Server> {
    // Port 0 — OS picks a free port; startHealthServer calls listen() internally
    const server = startHealthServer(0, workers);
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

  it("returns 200 when all workers are running", async () => {
    const server = await makeServer([
      { name: "email", worker: makeWorker(true, false) },
      { name: "image", worker: makeWorker(true, false) },
    ]);

    const { status, body } = await getHealth(server);

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("returns 503 when a worker has stopped (isRunning = false)", async () => {
    const server = await makeServer([
      { name: "email", worker: makeWorker(true, false) },
      { name: "payout", worker: makeWorker(false, false) }, // stopped
    ]);

    const { status, body } = await getHealth(server);

    expect(status).toBe(503);
    expect(body.status).toBe("unhealthy");
  });

  it("returns 503 when a worker is paused", async () => {
    const server = await makeServer([
      { name: "email", worker: makeWorker(true, true) }, // paused
    ]);

    const { status, body } = await getHealth(server);

    expect(status).toBe(503);
    expect(body.status).toBe("unhealthy");
  });

  it("includes per-worker status in the response body", async () => {
    const server = await makeServer([
      { name: "email", worker: makeWorker(true, false) },
      { name: "image", worker: makeWorker(false, false) },
    ]);

    const { body } = await getHealth(server);
    const workers = body.workers as Array<{
      name: string;
      running: boolean;
      paused: boolean;
    }>;

    const emailStatus = workers.find((w) => w.name === "email");
    const imageStatus = workers.find((w) => w.name === "image");

    expect(emailStatus?.running).toBe(true);
    expect(imageStatus?.running).toBe(false);
  });

  it("returns 200 with empty workers array (no workers configured)", async () => {
    const server = await makeServer([]);

    const { status, body } = await getHealth(server);

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  // ── Fix 4: pickup worker included in health check ─────────────────────────

  it("includes pickup worker status in the response body", async () => {
    const server = await makeServer([
      { name: "email", worker: makeWorker(true, false) },
      { name: "image", worker: makeWorker(true, false) },
      { name: "payout", worker: makeWorker(true, false) },
      { name: "pickup", worker: makeWorker(true, false) },
    ]);

    const { body } = await getHealth(server);
    const workers = body.workers as Array<{ name: string }>;
    const names = workers.map((w) => w.name);

    expect(names).toContain("pickup");
  });

  it("returns 503 when pickup worker has stopped", async () => {
    const server = await makeServer([
      { name: "email", worker: makeWorker(true, false) },
      { name: "image", worker: makeWorker(true, false) },
      { name: "payout", worker: makeWorker(true, false) },
      { name: "pickup", worker: makeWorker(false, false) }, // pickup stopped
    ]);

    const { status, body } = await getHealth(server);

    expect(status).toBe(503);
    expect(body.status).toBe("unhealthy");
  });

  it("returns 200 ok when all 4 workers (email, image, payout, pickup) are running", async () => {
    const server = await makeServer([
      { name: "email", worker: makeWorker(true, false) },
      { name: "image", worker: makeWorker(true, false) },
      { name: "payout", worker: makeWorker(true, false) },
      { name: "pickup", worker: makeWorker(true, false) },
    ]);

    const { status, body } = await getHealth(server);

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    const workers = body.workers as Array<{ name: string; running: boolean }>;
    expect(workers).toHaveLength(4);
    expect(workers.every((w) => w.running)).toBe(true);
  });

  it("worker list in response includes all 4 expected worker names", async () => {
    const server = await makeServer([
      { name: "email", worker: makeWorker(true, false) },
      { name: "image", worker: makeWorker(true, false) },
      { name: "payout", worker: makeWorker(true, false) },
      { name: "pickup", worker: makeWorker(true, false) },
    ]);

    const { body } = await getHealth(server);
    const workers = body.workers as Array<{ name: string }>;
    const names = workers.map((w) => w.name);

    expect(names).toContain("email");
    expect(names).toContain("image");
    expect(names).toContain("payout");
    expect(names).toContain("pickup");
  });
});
