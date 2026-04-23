// src/test/distributed-lock-codes.test.ts
// ─── Tests: withLock error codes (Fix 3) ─────────────────────────────────────
// Verifies that withLock throws typed AppError codes — not relying on message
// string matching — so callers can handle lock contention vs Redis failure
// with the correct HTTP status codes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { createMockRedis } from "./fixtures";

vi.mock("server-only", () => ({}));

// ── Override the setup.ts mock so we use the REAL withLock implementation.
// setup.ts mocks distributedLock to skip Redis; here we need the real code.
vi.mock("@/server/lib/distributedLock", async (importOriginal) => {
  return importOriginal();
});

// ── Control Redis so we can simulate lock-held vs unavailable.
const _redis = createMockRedis();
const mockRedisSet = _redis.set;
const mockRedisGet = _redis.get;
// Additional mocks needed by withLockAndHeartbeat (expire) and releaseLock (eval)
const mockRedisExpire = vi.fn().mockResolvedValue(1);
const mockRedisEval = vi.fn().mockResolvedValue(1);

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    ..._redis,
    eval: mockRedisEval,
    expire: mockRedisExpire,
  }),
}));

// Import AFTER mocks are set up
import { withLock, withLockAndHeartbeat } from "@/server/lib/distributedLock";
import { AppError } from "@/shared/errors";

// ─────────────────────────────────────────────────────────────────────────────

describe("withLock — typed error codes (Fix 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No NODE_ENV stubbing — withLock no longer has a dev fallback. Behaviour
    // is identical in dev and production. Callers must opt in to fail-open
    // explicitly via { failOpen: true }.
  });

  // Test 1: Lock held by another process → LOCK_CONTENTION (409)
  it("throws LOCK_CONTENTION (409) when Redis SET NX returns null (lock held)", async () => {
    // Redis SET NX returns null when key already exists
    mockRedisSet.mockResolvedValueOnce(null);

    const fn = vi.fn();
    await expect(withLock("test-resource", fn)).rejects.toMatchObject({
      code: "LOCK_CONTENTION",
      statusCode: 409,
    });

    // The protected function must NOT have been called
    expect(fn).not.toHaveBeenCalled();
  });

  // Test 2: Redis unavailable → LOCK_UNAVAILABLE (503)
  it("throws LOCK_UNAVAILABLE (503) when Redis throws (infrastructure failure)", async () => {
    // Redis connection failure
    mockRedisSet.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const fn = vi.fn();
    await expect(withLock("test-resource", fn)).rejects.toMatchObject({
      code: "LOCK_UNAVAILABLE",
      statusCode: 503,
    });

    // The protected function must NOT have been called
    expect(fn).not.toHaveBeenCalled();
  });

  // Test 3: Lock acquired → fn runs, no error thrown
  it("runs the protected function when the lock is successfully acquired", async () => {
    // Redis SET NX returns 'OK' — lock acquired
    mockRedisSet.mockResolvedValueOnce("OK");
    // releaseLock calls redis.eval — already mocked

    const fn = vi.fn().mockResolvedValue("result");
    const result = await withLock("test-resource", fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe("result");
  });

  // Test 4: Caller checks lockErr.code === "LOCK_UNAVAILABLE" (not string match)
  it("LOCK_UNAVAILABLE has the correct code property for programmatic handling", async () => {
    mockRedisSet.mockRejectedValueOnce(new Error("Redis down"));

    let caughtErr: unknown;
    try {
      await withLock("test-resource", vi.fn());
    } catch (e) {
      caughtErr = e;
    }

    // Must be an AppError with code property — not require string matching
    expect(caughtErr).toBeInstanceOf(AppError);
    const appErr = caughtErr as AppError;
    expect(appErr.code).toBe("LOCK_UNAVAILABLE");
    // Verify code comparison works (what callers now do)
    expect(appErr.code === "LOCK_UNAVAILABLE").toBe(true);
  });

  // Test 5: Unknown errors from fn() propagate unchanged
  it("propagates errors thrown by the protected function without wrapping", async () => {
    // Lock acquired successfully
    mockRedisSet.mockResolvedValueOnce("OK");

    const originalError = new Error("business logic failure");
    const fn = vi.fn().mockRejectedValue(originalError);

    await expect(withLock("test-resource", fn)).rejects.toThrow(
      "business logic failure",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for explicit failOpen — no NODE_ENV-based dev fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("withLock — explicit failOpen behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("failOpen: true → runs fn even when Redis is unavailable", async () => {
    mockRedisSet.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const fn = vi.fn().mockResolvedValue("ran-without-lock");
    const result = await withLock("test-resource", fn, { failOpen: true });

    expect(result).toBe("ran-without-lock");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("failOpen: true → runs fn even when lock is held", async () => {
    mockRedisSet.mockResolvedValueOnce(null); // SET NX returns null = held

    const fn = vi.fn().mockResolvedValue("ran-anyway");
    const result = await withLock("test-resource", fn, { failOpen: true });

    expect(result).toBe("ran-anyway");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("failOpen: false → throws LOCK_UNAVAILABLE when Redis is unavailable", async () => {
    mockRedisSet.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const fn = vi.fn();
    await expect(
      withLock("test-resource", fn, { failOpen: false }),
    ).rejects.toMatchObject({ code: "LOCK_UNAVAILABLE", statusCode: 503 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("failOpen unset (default) → fail-closed behaviour applies", async () => {
    // No NODE_ENV stubbing — proves there is no dev fallback. The default
    // behaviour is fail-closed in BOTH dev and production.
    mockRedisSet.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const fn = vi.fn();
    await expect(withLock("test-resource", fn)).rejects.toMatchObject({
      code: "LOCK_UNAVAILABLE",
      statusCode: 503,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("releases the lock even when fn throws (lock acquired path)", async () => {
    // Lock acquired → fn throws → release in finally
    mockRedisSet.mockResolvedValueOnce("OK");

    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withLock("test-resource", fn)).rejects.toThrow("boom");

    // fn was invoked once (lock was acquired). The release path is exercised
    // via the eval mock on the shared Redis client mock above.
    expect(fn).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withLockAndHeartbeat — acquisition, heartbeat, finally behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("withLockAndHeartbeat — acquisition edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisEval.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
  });

  it("throws LOCK_UNAVAILABLE (503) when Redis throws during acquisition", async () => {
    mockRedisSet.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const fn = vi.fn();
    await expect(
      withLockAndHeartbeat("resource-hb", fn, { ttlSeconds: 30 }),
    ).rejects.toMatchObject({
      code: "LOCK_UNAVAILABLE",
      statusCode: 503,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("throws LOCK_CONTENTION (409) when SET NX returns null (lock held)", async () => {
    mockRedisSet.mockResolvedValueOnce(null);

    const fn = vi.fn();
    await expect(
      withLockAndHeartbeat("resource-hb", fn, { ttlSeconds: 30 }),
    ).rejects.toMatchObject({
      code: "LOCK_CONTENTION",
      statusCode: 409,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("releases the lock in finally even when fn throws", async () => {
    mockRedisSet.mockResolvedValueOnce("OK");

    const fn = vi.fn().mockRejectedValue(new Error("business logic exploded"));

    await expect(
      withLockAndHeartbeat("resource-hb", fn, { ttlSeconds: 30 }),
    ).rejects.toThrow("business logic exploded");

    expect(fn).toHaveBeenCalledOnce();
    // releaseLock runs the Lua compare-and-delete via redis.eval
    expect(mockRedisEval).toHaveBeenCalled();
  });

  it("returns the fn() result when lock is successfully acquired", async () => {
    mockRedisSet.mockResolvedValueOnce("OK");

    const fn = vi.fn().mockResolvedValue("fn-result");
    const result = await withLockAndHeartbeat("resource-hb", fn, {
      ttlSeconds: 30,
    });

    expect(result).toBe("fn-result");
  });
});

describe("withLockAndHeartbeat — heartbeat behaviour (fake timers)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockRedisEval.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
  });

  // Always restore real timers so unrelated tests (or other files) are unaffected
  // when this describe finishes.
  const restoreTimers = () => vi.useRealTimers();

  it("extends TTL via expire() when the lock value still matches", async () => {
    // Snapshot the lockValue that SET was called with so the heartbeat's
    // compare-and-extend path sees a match (redis.get returns that same value).
    let capturedLockValue: string | undefined;
    mockRedisSet.mockImplementationOnce(async (_key: string, value: string) => {
      capturedLockValue = value;
      return "OK";
    });

    mockRedisGet.mockImplementation(async () => capturedLockValue);

    // fn() resolves after ~25 s — enough to fire at least one heartbeat tick
    // (interval = ttl/3 = 10 s for ttl=30).
    const fn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("done"), 25_000);
        }),
    );

    const promise = withLockAndHeartbeat("resource-hb", fn, {
      ttlSeconds: 30,
    });

    // Advance past one heartbeat interval (10s) plus let microtasks run
    await vi.advanceTimersByTimeAsync(11_000);

    // Heartbeat should have: get() then expire(key, ttl)
    expect(mockRedisGet).toHaveBeenCalled();
    expect(mockRedisExpire).toHaveBeenCalledWith("km:lock:resource-hb", 30);

    // Let fn() finish
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(promise).resolves.toBe("done");

    restoreTimers();
  });

  it("does NOT extend TTL when heartbeat detects lock value mismatch", async () => {
    mockRedisSet.mockResolvedValueOnce("OK");
    // redis.get returns a DIFFERENT value — simulates lock stolen by another worker
    mockRedisGet.mockResolvedValue("lock:SOMEBODY_ELSE");

    const fn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("done"), 15_000);
        }),
    );

    const promise = withLockAndHeartbeat("resource-hb", fn, {
      ttlSeconds: 30,
    });

    await vi.advanceTimersByTimeAsync(11_000);

    // Mismatch branch taken — get called, but expire NOT called
    expect(mockRedisGet).toHaveBeenCalled();
    expect(mockRedisExpire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toBe("done");

    restoreTimers();
  });

  it("does not crash when the heartbeat Redis call fails", async () => {
    mockRedisSet.mockResolvedValueOnce("OK");
    // get() rejects → heartbeat catch branch logs a warning but stays alive
    mockRedisGet.mockRejectedValue(new Error("Redis GET timeout"));

    const fn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("done"), 15_000);
        }),
    );

    const promise = withLockAndHeartbeat("resource-hb", fn, {
      ttlSeconds: 30,
    });

    await vi.advanceTimersByTimeAsync(11_000);

    // get() attempted and failed; expire() never reached (error path)
    expect(mockRedisGet).toHaveBeenCalled();
    expect(mockRedisExpire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    // fn still completes despite heartbeat failure (non-fatal path)
    await expect(promise).resolves.toBe("done");

    restoreTimers();
  });

  it("respects a custom heartbeatIntervalSeconds override", async () => {
    let capturedLockValue: string | undefined;
    mockRedisSet.mockImplementationOnce(async (_key: string, value: string) => {
      capturedLockValue = value;
      return "OK";
    });
    mockRedisGet.mockImplementation(async () => capturedLockValue);

    const fn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("done"), 10_000);
        }),
    );

    const promise = withLockAndHeartbeat("resource-hb", fn, {
      ttlSeconds: 60,
      heartbeatIntervalSeconds: 2, // fire every 2 s instead of ttl/3 = 20 s
    });

    // After 2.5 s, the 2-second heartbeat should have already ticked
    await vi.advanceTimersByTimeAsync(2_500);
    expect(mockRedisGet).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toBe("done");

    restoreTimers();
  });
});
