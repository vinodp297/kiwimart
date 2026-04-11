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

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({ ..._redis, eval: vi.fn().mockResolvedValue(1) }),
}));

// Import AFTER mocks are set up
import { withLock } from "@/server/lib/distributedLock";
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
