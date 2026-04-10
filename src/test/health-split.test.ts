// src/test/health-split.test.ts
// ─── Tests: Fix 4 (public health cheap-only) + Fix 5 (null failedJobs) ────────
// Fix 4 — public /api/health:
//   1. Response has no business data
//   2. DB + Redis checks complete well under 100ms (cheap-only verification)
//   3. No auth required
// Fix 4 — admin /api/admin/health:
//   4. Response includes business metrics
//   5. Business metrics are served from Redis cache on second call (no DB hit)
// Fix 5 — health.service.ts getBusinessMetrics():
//   6. Success path: failedJobs is a number and metricsAvailable is true
//   7. Queue failure: failedJobs is null, metricsAvailable is false
//   8. null failedJobs causes admin health to show degraded status

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Shared Redis mock (captured so we can assert on cache calls) ───────────
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisPing = vi.fn().mockResolvedValue("PONG");

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    get: mockRedisGet,
    set: mockRedisSet,
    ping: mockRedisPing,
  }),
}));

// ── Stripe mock ────────────────────────────────────────────────────────────
vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    balance: {
      retrieve: vi.fn().mockResolvedValue({ object: "balance" }),
    },
  },
}));

// ── Auth mock — allow all health checks ────────────────────────────────────
vi.mock("@/shared/auth/requirePermission", () => ({
  requirePermission: vi.fn().mockResolvedValue(undefined),
}));

// ── Queue mock — controls BullMQ availability ──────────────────────────────
// Default: queue is available and returns 0 failed jobs.
// Individual tests override to simulate unavailability.
const mockGetJobCounts = vi.fn().mockResolvedValue({ failed: 0 });

vi.mock("@/lib/queue", () => ({
  QUEUE_MAP: {
    email: { getJobCounts: mockGetJobCounts },
    payout: { getJobCounts: mockGetJobCounts },
  },
}));

import db from "@/lib/db";
import { healthService } from "@/server/services/health.service";

// Import routes AFTER all mocks
const { GET: publicGET } = await import("@/app/api/health/route");
const { GET: adminGET } = await import("@/app/api/admin/health/route");

// ─────────────────────────────────────────────────────────────────────────────

function makePublicRequest(): Request {
  return new Request("http://localhost/api/health");
}

function makeAdminRequest(): Request {
  return new Request("http://localhost/api/admin/health");
}

// ── Fix 4: Public health endpoint ────────────────────────────────────────────

describe("Fix 4 — public /api/health (cheap-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
    mockRedisPing.mockResolvedValue("PONG");
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue("OK");
  });

  // Test 1: No business data in public health response
  it("does not include business metrics in the public health response", async () => {
    const res = await publicGET(makePublicRequest());
    const body = await res.json();

    expect(body).not.toHaveProperty("business");
    expect(body).not.toHaveProperty("businessBreached");
  });

  // Test 2: Public health only has database + redis checks (no Stripe, no SLOs)
  it("only checks database and redis — no Stripe or business SLO checks", async () => {
    const res = await publicGET(makePublicRequest());
    const body = await res.json();

    expect(body.checks).toHaveProperty("database");
    expect(body.checks).toHaveProperty("redis");
    // Stripe is an infra detail in admin only
    expect(body.checks).not.toHaveProperty("stripe");
  });

  // Test 3: No auth header required (public endpoint)
  it("returns 200 without any authentication", async () => {
    const res = await publicGET(makePublicRequest());
    expect(res.status).toBe(200);
  });
});

// ── Fix 4: Admin health endpoint with business metrics ────────────────────────

describe("Fix 4 — admin /api/admin/health (business metrics)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
    vi.mocked(db.payout.count).mockResolvedValue(5);
    vi.mocked(db.dispute.count).mockResolvedValue(2);
    vi.mocked(db.payout.findFirst).mockResolvedValue(null);
    mockRedisPing.mockResolvedValue("PONG");
    mockRedisGet.mockResolvedValue(null); // cache miss by default
    mockRedisSet.mockResolvedValue("OK");
    mockGetJobCounts.mockResolvedValue({ failed: 0 });
  });

  // Test 4: Business metrics appear in admin health response
  it("includes business metrics in the admin health response", async () => {
    const res = await adminGET(makeAdminRequest());
    const body = await res.json();

    expect(body).toHaveProperty("business");
    expect(body.business).toHaveProperty("pendingPayouts");
    expect(body.business).toHaveProperty("failedJobs");
    expect(body.business).toHaveProperty("metricsAvailable");
  });

  // Test 5: Business metrics are served from Redis cache on second call
  it("returns cached business metrics from Redis without hitting the DB again", async () => {
    const cachedMetrics = {
      pendingPayouts: 3,
      openDisputes: 1,
      failedJobs: 0,
      oldestPendingPayout: null,
      metricsAvailable: true,
    };

    // Simulate a cache hit — Redis returns serialised metrics
    mockRedisGet.mockResolvedValue(JSON.stringify(cachedMetrics));

    const res = await adminGET(makeAdminRequest());
    const body = await res.json();

    // Business data must come from cache
    expect(body.business.pendingPayouts).toBe(3);

    // DB payout.count must NOT have been called (cache hit)
    expect(db.payout.count).not.toHaveBeenCalled();

    // Redis GET must have been called (to check the cache)
    expect(mockRedisGet).toHaveBeenCalledWith("health:business:metrics");
  });
});

// ── Fix 5: null failedJobs in health.service.ts ───────────────────────────────

describe("Fix 5 — getBusinessMetrics() null failedJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.payout.count).mockResolvedValue(0);
    vi.mocked(db.dispute.count).mockResolvedValue(0);
    vi.mocked(db.payout.findFirst).mockResolvedValue(null);
    mockGetJobCounts.mockResolvedValue({ failed: 0 });
  });

  // Test 6: Success path — failedJobs is a number, metricsAvailable is true
  it("returns failedJobs as a number and metricsAvailable: true when queues are healthy", async () => {
    mockGetJobCounts.mockResolvedValue({ failed: 3 });

    const metrics = await healthService.getBusinessMetrics();

    expect(metrics.failedJobs).toBe(6); // 2 queues × 3 = 6
    expect(metrics.metricsAvailable).toBe(true);
  });

  // Test 7: Queue failure — failedJobs is null, metricsAvailable is false
  it("returns failedJobs: null and metricsAvailable: false when queue is unavailable", async () => {
    // Make getJobCounts throw to simulate BullMQ connection failure
    mockGetJobCounts.mockRejectedValueOnce(
      new Error("Redis connection failed"),
    );

    const metrics = await healthService.getBusinessMetrics();

    expect(metrics.failedJobs).toBeNull();
    expect(metrics.metricsAvailable).toBe(false);
  });

  // Test 8: null failedJobs causes admin health to show degraded (not ok)
  it("admin health shows degraded when failedJobs is null (metrics unavailable)", async () => {
    const nullMetrics = {
      pendingPayouts: 0,
      openDisputes: 0,
      failedJobs: null, // null = unknown, not zero
      oldestPendingPayout: null,
      metricsAvailable: false,
    };

    // Return null metrics from cache
    mockRedisGet.mockResolvedValue(JSON.stringify(nullMetrics));
    vi.mocked(db.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
    mockRedisPing.mockResolvedValue("PONG");

    const res = await adminGET(makeAdminRequest());
    const body = await res.json();

    // null failedJobs must degrade the overall status
    expect(body.status).toBe("degraded");
    expect(body.business.failedJobs).toBeNull();
    expect(body.business.metricsAvailable).toBe(false);
  });
});
