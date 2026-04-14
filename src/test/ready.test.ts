// src/test/ready.test.ts
// ─── Tests for /api/ready readiness probe ────────────────────────────────────
//
// Verifies that the readiness endpoint correctly returns HTTP 503 when any
// critical dependency (DB, Redis, BullMQ) is unavailable, and HTTP 200 when
// all are healthy.
//
// Tests:
//   1. All deps healthy → 200 { status: "ready" }
//   2. Redis down → 503 { status: "not_ready", failing: ["redis"] }
//   3. BullMQ down → 503 { status: "not_ready", failing: ["bullmq"] }
//   4. DB down → 503 { status: "not_ready", failing: ["database"] }
//   5. Multiple deps down → 503 with all failing names in array
//   6. /api/health still returns 200 when Redis is down (liveness unaffected)

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Redis mock ────────────────────────────────────────────────────────────────
const mockPing = vi.fn().mockResolvedValue("PONG");

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn(() => ({ ping: mockPing })),
}));

// ── BullMQ queue mock ─────────────────────────────────────────────────────────
const mockGetFailedCount = vi.fn().mockResolvedValue(0);

vi.mock("@/lib/queue", () => ({
  payoutQueue: { getFailedCount: mockGetFailedCount },
  emailQueue: { getFailedCount: mockGetFailedCount },
  // health-split.test.ts also uses QUEUE_MAP — keep it here for compatibility
  QUEUE_MAP: {
    email: { getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }) },
    payout: { getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }) },
  },
}));

import db from "@/lib/db";

// Import AFTER all mocks are registered
const { GET: readyGET } = await import("@/app/api/ready/route");
const { GET: healthGET } = await import("@/app/api/health/route");

// ─────────────────────────────────────────────────────────────────────────────

function makeReadyRequest(): Request {
  return new Request("http://localhost/api/ready");
}

function makeHealthRequest(): Request {
  return new Request("http://localhost/api/health");
}

describe("/api/ready — readiness probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Happy-path defaults
    vi.mocked(db.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
    mockPing.mockResolvedValue("PONG");
    mockGetFailedCount.mockResolvedValue(0);
  });

  // ── Test 1: all deps healthy ──────────────────────────────────────────────

  it("returns 200 { status: ready } when all dependencies are healthy", async () => {
    const res = await readyGET(makeReadyRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.failing).toBeUndefined();
  });

  // ── Test 2: Redis down → 503 ──────────────────────────────────────────────

  it("returns 503 with failing: [redis] when Redis is unreachable", async () => {
    mockPing.mockRejectedValue(new Error("Redis connection refused"));

    const res = await readyGET(makeReadyRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.failing).toContain("redis");
    expect(body.failing).not.toContain("database");
    expect(body.failing).not.toContain("bullmq");
  });

  // ── Test 3: BullMQ down → 503 ─────────────────────────────────────────────

  it("returns 503 with failing: [bullmq] when BullMQ is unreachable", async () => {
    mockGetFailedCount.mockRejectedValue(
      new Error("BullMQ connection refused"),
    );

    const res = await readyGET(makeReadyRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.failing).toContain("bullmq");
    expect(body.failing).not.toContain("redis");
    expect(body.failing).not.toContain("database");
  });

  // ── Test 4: DB down → 503 ────────────────────────────────────────────────

  it("returns 503 with failing: [database] when the database is unreachable", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValue(new Error("connection refused"));

    const res = await readyGET(makeReadyRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.failing).toContain("database");
  });

  // ── Test 5: multiple deps down → all appear in failing array ─────────────

  it("reports all failing dependencies when multiple are down", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValue(new Error("DB down"));
    mockPing.mockRejectedValue(new Error("Redis down"));

    const res = await readyGET(makeReadyRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.failing).toContain("database");
    expect(body.failing).toContain("redis");
  });

  // ── Test 6: /api/health still 200 when Redis down (liveness unaffected) ──

  it("GET /api/health still returns 200 when Redis is down (liveness probe)", async () => {
    mockPing.mockRejectedValue(new Error("Redis connection refused"));

    const res = await healthGET(makeHealthRequest());
    const body = await res.json();

    // Liveness always 200 — process is alive regardless of Redis status
    expect(res.status).toBe(200);
    expect(body.checks.redis).toBe("unreachable");
    // Status in body reflects degradation but HTTP is still 200
    expect(body.status).toBe("degraded");
  });
});
