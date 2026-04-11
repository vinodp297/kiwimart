// src/test/lock-heartbeat.test.ts
// ─── Tests: withLockAndHeartbeat() in distributedLock.ts ─────────────────────
// Covers:
//   1. Lock acquired → heartbeat extends TTL every interval
//   2. fn() completes → heartbeat stops → lock released
//   3. fn() throws → heartbeat stops → lock released
//   4. Heartbeat failure (Redis error) → lock still released on completion
//   5. Only extends lock if still the owner (lockValue check)
//   6. Correct timer setup: TTL 120s, interval 40s

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Fake timers ───────────────────────────────────────────────────────────────
// We need fake timers to control setInterval behaviour in the heartbeat.

// ── Hoisted Redis mock ────────────────────────────────────────────────────────

const {
  mockRedisSet,
  mockRedisGet,
  mockRedisExpire,
  mockRedisEval,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockRedisSet: vi.fn(),
  mockRedisGet: vi.fn(),
  mockRedisExpire: vi.fn(),
  mockRedisEval: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    set: (...args: unknown[]) => mockRedisSet(...args),
    get: (...args: unknown[]) => mockRedisGet(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
    eval: (...args: unknown[]) => mockRedisEval(...args),
  }),
}));

vi.mock("@/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: vi.fn(),
  },
}));

vi.mock("@/shared/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/errors")>();
  return actual;
});

// Restore the real distributedLock implementation so these tests exercise the
// actual withLockAndHeartbeat code path (Redis is mocked above).
vi.unmock("@/server/lib/distributedLock");

// ── Import under test ─────────────────────────────────────────────────────────

import { withLockAndHeartbeat } from "@/server/lib/distributedLock";

// ── Helpers ───────────────────────────────────────────────────────────────────

function capturedLockValue(): string {
  // The lock value is the value passed to redis.set on acquisition.
  const [, value] = mockRedisSet.mock.calls[0] as [string, string];
  return value;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("withLockAndHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRedisSet.mockReset();
    mockRedisGet.mockReset();
    mockRedisExpire.mockReset();
    mockRedisEval.mockReset();
    mockLoggerWarn.mockReset();

    // Default: lock acquired ('OK'), get returns lockValue, expire ok, eval ok
    mockRedisSet.mockResolvedValue("OK");
    mockRedisGet.mockImplementation(() => Promise.resolve(capturedLockValue()));
    mockRedisExpire.mockResolvedValue(1);
    // Lua compare-and-delete returns 1 (deleted)
    mockRedisEval.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("acquires the lock and runs fn()", async () => {
    const fn = vi.fn().mockResolvedValue("result");

    const result = await withLockAndHeartbeat("test:resource", fn, {
      ttlSeconds: 30,
    });

    expect(result).toBe("result");
    expect(fn).toHaveBeenCalledOnce();
    // Redis set called with NX and correct TTL
    expect(mockRedisSet).toHaveBeenCalledWith(
      "km:lock:test:resource",
      expect.stringMatching(/^lock:/),
      { nx: true, ex: 30 },
    );
  });

  it("heartbeat extends TTL at each interval", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      // Advance fake timers by 2 full intervals to trigger 2 heartbeats
      await vi.advanceTimersByTimeAsync(80_000); // 2 × 40s
      return "done";
    });

    await withLockAndHeartbeat("test:resource", fn, {
      ttlSeconds: 120,
      heartbeatIntervalSeconds: 40,
    });

    // expire called at least twice (once per interval during fn)
    expect(mockRedisExpire).toHaveBeenCalledTimes(2);
    expect(mockRedisExpire).toHaveBeenCalledWith("km:lock:test:resource", 120);
  });

  it("heartbeat fires every heartbeatIntervalSeconds", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      // Advance exactly one interval
      await vi.advanceTimersByTimeAsync(40_000);
      return "done";
    });

    await withLockAndHeartbeat("test:resource", fn, {
      ttlSeconds: 120,
      heartbeatIntervalSeconds: 40,
    });

    expect(mockRedisExpire).toHaveBeenCalledTimes(1);
  });

  it("heartbeat defaults to ttlSeconds / 3 when not specified", async () => {
    // With ttlSeconds=120 and no heartbeatIntervalSeconds,
    // default interval = 40s. After 40s we expect one heartbeat.
    const fn = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
      return "done";
    });

    await withLockAndHeartbeat("test:resource", fn, { ttlSeconds: 120 });

    expect(mockRedisExpire).toHaveBeenCalledTimes(1);
  });

  it("fn() completes → lock is released", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    await withLockAndHeartbeat("test:resource", fn, { ttlSeconds: 30 });

    // Lua compare-and-delete called (releaseLock)
    expect(mockRedisEval).toHaveBeenCalledOnce();
  });

  it("fn() throws → heartbeat stops → lock is still released", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("handler failure"));

    await expect(
      withLockAndHeartbeat("test:resource", fn, { ttlSeconds: 30 }),
    ).rejects.toThrow("handler failure");

    // Lock still released despite fn() throwing
    expect(mockRedisEval).toHaveBeenCalledOnce();
  });

  it("heartbeat stops after fn() completes — no further expire calls", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      // One heartbeat fires during fn()
      await vi.advanceTimersByTimeAsync(40_000);
      return "done";
    });

    await withLockAndHeartbeat("test:resource", fn, {
      ttlSeconds: 120,
      heartbeatIntervalSeconds: 40,
    });

    const expireCallsDuringFn = mockRedisExpire.mock.calls.length;

    // Advance clock further — heartbeat should NOT fire after fn() completes
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mockRedisExpire).toHaveBeenCalledTimes(expireCallsDuringFn);
  });

  it("only extends lock if still the owner (compare-before-extend)", async () => {
    // Simulate lock stolen: get returns a DIFFERENT lock value
    mockRedisGet.mockResolvedValue("lock:some-other-worker");

    const fn = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(40_000); // trigger one heartbeat
      return "done";
    });

    await withLockAndHeartbeat("test:resource", fn, {
      ttlSeconds: 120,
      heartbeatIntervalSeconds: 40,
    });

    // get was called but expire was NOT called (we don't own the lock)
    expect(mockRedisGet).toHaveBeenCalled();
    expect(mockRedisExpire).not.toHaveBeenCalled();
  });

  it("heartbeat failure (Redis error) is non-fatal — lock still released", async () => {
    mockRedisGet.mockRejectedValue(new Error("Redis timeout"));

    const fn = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
      return "done";
    });

    // Should not throw despite heartbeat failure
    const result = await withLockAndHeartbeat("test:resource", fn, {
      ttlSeconds: 120,
      heartbeatIntervalSeconds: 40,
    });

    expect(result).toBe("done");
    // Warning logged for heartbeat failure
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "distributedLock.heartbeat_failed",
      { resource: "test:resource" },
    );
    // Lock still released
    expect(mockRedisEval).toHaveBeenCalledOnce();
  });

  it("throws LOCK_CONTENTION (409) when lock is already held", async () => {
    // Redis NX returns null → lock held
    mockRedisSet.mockResolvedValue(null);

    const fn = vi.fn();

    await expect(
      withLockAndHeartbeat("test:resource", fn, { ttlSeconds: 30 }),
    ).rejects.toMatchObject({
      code: "LOCK_CONTENTION",
      statusCode: 409,
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it("throws LOCK_UNAVAILABLE (503) when Redis is unreachable during acquisition", async () => {
    mockRedisSet.mockRejectedValue(new Error("ECONNREFUSED"));

    const fn = vi.fn();

    await expect(
      withLockAndHeartbeat("test:resource", fn, { ttlSeconds: 30 }),
    ).rejects.toMatchObject({
      code: "LOCK_UNAVAILABLE",
      statusCode: 503,
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it("auto-resolution config: TTL=120s, interval=40s produces correct timer setup", async () => {
    // Verify the exact timer values used by auto-resolution.service.ts
    const fn = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(40_000); // one interval
      return "resolved";
    });

    await withLockAndHeartbeat("dispute:test-id", fn, {
      ttlSeconds: 120,
      heartbeatIntervalSeconds: 40,
    });

    // After one 40s interval: one heartbeat fired and extended to 120s
    expect(mockRedisExpire).toHaveBeenCalledWith(
      "km:lock:dispute:test-id",
      120,
    );
  });
});
