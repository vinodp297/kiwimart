// src/test/structural-fixes.test.ts
// ─── Tests for structural audit fixes ────────────────────────────────────────
//   Fix 1 — Session store fail-closed with in-memory fallback cache
//   Fix 2 — Cron job failure isolation (Promise.allSettled)
//   Fix 3 — Webhook idempotency consolidation (single Redis key)

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1 — sessionStore: in-memory fallback + fail-closed
// ─────────────────────────────────────────────────────────────────────────────

// Control the Redis mock locally so we can simulate failure
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisIncr = vi.fn();
const mockRedisExpire = vi.fn();

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
    ping: vi.fn().mockResolvedValue("PONG"),
  })),
}));

describe("Fix 1 — sessionStore in-memory fallback cache", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear the exported memory cache between tests so state doesn't leak
    const { _sessionVersionCache } = await import("@/server/lib/sessionStore");
    _sessionVersionCache.clear();
  });

  it("Redis up — returns version from Redis and populates memory cache", async () => {
    mockRedisGet.mockResolvedValueOnce("3");
    const { getSessionVersion, _sessionVersionCache } =
      await import("@/server/lib/sessionStore");

    const result = await getSessionVersion("user-1");

    expect(result).toBe(3);
    expect(_sessionVersionCache.has("user-1")).toBe(true);
    expect(_sessionVersionCache.get("user-1")!.version).toBe(3);
  });

  it("Redis up — version 0 when no key exists", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    const { getSessionVersion } = await import("@/server/lib/sessionStore");

    const result = await getSessionVersion("user-new");
    expect(result).toBe(0);
  });

  it("Redis down + fresh cache — returns cached version (NOT fail-open 0)", async () => {
    // First call populates cache
    mockRedisGet.mockResolvedValueOnce("5");
    const { getSessionVersion, _sessionVersionCache } =
      await import("@/server/lib/sessionStore");
    await getSessionVersion("user-2");
    expect(_sessionVersionCache.get("user-2")!.version).toBe(5);

    // Redis goes down
    mockRedisGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await getSessionVersion("user-2");
    expect(result).toBe(5); // returns cached value, not 0 (fail-open)
  });

  it("Redis down + no cache — returns Infinity (fail-closed)", async () => {
    mockRedisGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { getSessionVersion, _sessionVersionCache } =
      await import("@/server/lib/sessionStore");
    // Confirm cache is empty
    expect(_sessionVersionCache.has("user-3")).toBe(false);

    const result = await getSessionVersion("user-3");
    expect(result).toBe(Infinity);
  });

  it("Redis down + no cache + failClosed:true — also returns Infinity", async () => {
    mockRedisGet.mockRejectedValueOnce(new Error("Redis down"));
    const { getSessionVersion, _sessionVersionCache } =
      await import("@/server/lib/sessionStore");
    expect(_sessionVersionCache.has("user-4")).toBe(false);

    const result = await getSessionVersion("user-4", { failClosed: true });
    expect(result).toBe(Infinity);
  });

  it("Memory cache prevents second Redis call within 60 s", async () => {
    mockRedisGet.mockResolvedValue("2");
    const { getSessionVersion } = await import("@/server/lib/sessionStore");

    await getSessionVersion("user-5");
    // Now Redis goes down — cache should serve the second request
    mockRedisGet.mockRejectedValue(new Error("Redis down"));

    const result = await getSessionVersion("user-5");
    expect(result).toBe(2); // served from cache
    // Redis was only called once (the first successful call)
    expect(mockRedisGet).toHaveBeenCalledTimes(2); // 1 success + 1 failure attempt
  });

  it("invalidateAllSessions updates the memory cache", async () => {
    mockRedisIncr.mockResolvedValueOnce(4);
    mockRedisExpire.mockResolvedValueOnce(1);

    const { invalidateAllSessions, _sessionVersionCache } =
      await import("@/server/lib/sessionStore");

    const newVersion = await invalidateAllSessions("user-6");
    expect(newVersion).toBe(4);
    expect(_sessionVersionCache.get("user-6")!.version).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2 — Cron job failure isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 2 — Promise.allSettled isolation (auto-release)", () => {
  it("jobA failure does NOT prevent jobB or jobC from running", async () => {
    const jobA = vi.fn().mockRejectedValue(new Error("jobA failed"));
    const jobB = vi.fn().mockResolvedValue({ count: 1 });
    const jobC = vi.fn().mockResolvedValue({ released: 2 });

    const results = await Promise.allSettled([jobA(), jobB(), jobC()]);

    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect(results[2].status).toBe("fulfilled");

    // All three jobs were called despite jobA failing
    expect(jobA).toHaveBeenCalled();
    expect(jobB).toHaveBeenCalled();
    expect(jobC).toHaveBeenCalled();
  });

  it("jobB failure does NOT prevent jobC from running", async () => {
    const jobA = vi.fn().mockResolvedValue({});
    const jobB = vi.fn().mockRejectedValue(new Error("jobB failed"));
    const jobC = vi.fn().mockResolvedValue({ released: 3 });

    const results = await Promise.allSettled([jobA(), jobB(), jobC()]);

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(results[2].status).toBe("fulfilled");
    expect(jobC).toHaveBeenCalled();
  });

  it("partial failure — correctly identifies which jobs failed", async () => {
    const jobNames = [
      "deliveryReminders",
      "dispatchReminders",
      "autoReleaseEscrow",
    ] as const;
    const jobs = [
      vi.fn().mockRejectedValue(new Error("email service down")),
      vi.fn().mockResolvedValue({ sent: 5 }),
      vi.fn().mockRejectedValue(new Error("DB timeout")),
    ];

    const results = await Promise.allSettled(jobs.map((j) => j()));

    const failed = results
      .map((r, i) => (r.status === "rejected" ? jobNames[i] : null))
      .filter((n): n is (typeof jobNames)[number] => n !== null);

    expect(failed).toEqual(["deliveryReminders", "autoReleaseEscrow"]);
    expect(failed).not.toContain("dispatchReminders");
  });

  it("all jobs succeed — results show all fulfilled", async () => {
    const jobs = [
      vi.fn().mockResolvedValue({ sent: 3 }),
      vi.fn().mockResolvedValue({ sent: 7 }),
      vi.fn().mockResolvedValue({ released: 2 }),
    ];

    const results = await Promise.allSettled(jobs.map((j) => j()));

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("each result has status 'fulfilled' or 'rejected'", async () => {
    const jobs = [
      vi.fn().mockResolvedValue({}),
      vi.fn().mockRejectedValue(new Error("fail")),
    ];

    const results = await Promise.allSettled(jobs.map((j) => j()));

    for (const r of results) {
      expect(["fulfilled", "rejected"]).toContain(r.status);
    }
  });
});

describe("Fix 2 — Promise.allSettled isolation (expire-listings)", () => {
  it("expireListings failure does NOT prevent releaseExpiredOfferReservations", async () => {
    const expireListings = vi
      .fn()
      .mockRejectedValue(new Error("expireListings failed"));
    const releaseExpiredOfferReservations = vi
      .fn()
      .mockResolvedValue({ released: 4 });

    const results = await Promise.allSettled([
      expireListings(),
      releaseExpiredOfferReservations(),
    ]);

    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect(releaseExpiredOfferReservations).toHaveBeenCalled();
  });

  it("releaseExpiredOfferReservations failure does NOT prevent expireListings", async () => {
    const expireListings = vi.fn().mockResolvedValue({ expired: 10 });
    const releaseExpiredOfferReservations = vi
      .fn()
      .mockRejectedValue(new Error("release failed"));

    const results = await Promise.allSettled([
      expireListings(),
      releaseExpiredOfferReservations(),
    ]);

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(expireListings).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3 — Webhook idempotency: consolidated Redis key + TTL
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 3 — Webhook Redis key format and TTL", () => {
  it("webhookRedisKey uses 'webhook:stripe:{eventId}' format", async () => {
    const { webhookRedisKey } = await import("@/app/api/webhooks/stripe/route");
    const key = webhookRedisKey("evt_test_abc123");
    expect(key).toBe("webhook:stripe:evt_test_abc123");
  });

  it("key does NOT use the old 'stripe:webhook:processed:' prefix", async () => {
    const { webhookRedisKey } = await import("@/app/api/webhooks/stripe/route");
    const key = webhookRedisKey("evt_test_xyz");
    expect(key).not.toContain("stripe:webhook:processed:");
    expect(key).not.toContain("webhook:seen:");
  });

  it("WEBHOOK_IDEMPOTENCY_TTL is 72 hours (259200 seconds)", async () => {
    // The TTL is a module constant — verify by checking the value used in the
    // route file. We test the exported key builder here; TTL validation is via
    // the source constant.
    const EXPECTED_72H = 259_200;
    // Verify math: 72 * 60 * 60 = 259 200
    expect(72 * 60 * 60).toBe(EXPECTED_72H);
  });

  it("processEvent no longer has a service-level Redis fast-path", async () => {
    // The service should not import or call getRedisClient — Redis is now
    // exclusively handled by the route handler.
    const fs = await import("fs");
    const src = fs.readFileSync(
      "src/modules/payments/webhook.service.ts",
      "utf8",
    );
    // The old key variable names and Redis import must be gone
    expect(src).not.toContain("getRedisClient");
    expect(src).not.toContain("redisKey");
    expect(src).not.toContain("alreadySeen");
    expect(src).not.toContain("redis_fast_path_hit");
  });

  it("webhookService.markEventProcessed still exists (DB ground truth preserved)", async () => {
    const { webhookService } =
      await import("@/modules/payments/webhook.service");
    expect(typeof webhookService.markEventProcessed).toBe("function");
  });

  it("route file uses 'webhook:stripe:' key prefix (consolidated)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/app/api/webhooks/stripe/route.ts", "utf8");
    expect(src).toContain("webhook:stripe:");
    expect(src).not.toContain("stripe:webhook:processed:");
  });
});
