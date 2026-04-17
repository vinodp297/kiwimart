// src/test/pickup-otp-throttle.test.ts
// ─── OTP attempt throttling and lockout invariants ────────────────────────────
// Tests the Redis-backed brute-force protection added to verifyOTP():
//   • First incorrect attempt → counts down from OTP_MAX_ATTEMPTS
//   • 5th incorrect attempt   → locks the order and nulls the OTP hash
//   • Locked order            → rejected immediately, no hash comparison
//   • Correct code            → clears the attempt counter
//   • Redis unavailable       → fail-closed (verification refused, not bypassed)
//   • generateAndSendOTP      → clears both Redis keys on a fresh code
//
// Does NOT import setup.ts — that global mock replaces @/infrastructure/redis/client
// entirely. All dependencies are wired up locally instead.

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

vi.mock("server-only", () => ({}));

// ── Hoist mockRedis so the vi.mock() factory can reference it ─────────────────

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    get: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn(() => mockRedis),
}));

// ── Mock remaining deps ───────────────────────────────────────────────────────

vi.mock("@/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/lib/platform-config", () => ({
  CONFIG_KEYS: {
    PICKUP_OTP_EXPIRY_MINUTES: "PICKUP_OTP_EXPIRY_MINUTES",
  },
  getConfigInt: vi.fn().mockResolvedValue(15),
}));

vi.mock("@/server/services/sms/sms.service", () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
  formatNzPhoneE164: vi.fn().mockImplementation((p: string) => p),
}));

// ── Lazy import (after all mocks are registered) ──────────────────────────────

const { verifyOTP, generateAndSendOTP } =
  await import("@/server/services/pickup/pickup-otp.service");

// ── Helpers ───────────────────────────────────────────────────────────────────

const CORRECT_CODE = "123456";
const CORRECT_HASH = crypto
  .createHash("sha256")
  .update(CORRECT_CODE)
  .digest("hex");

const ORDER_ID = "order-otp-throttle";
const ATTEMPT_KEY = `otp:attempts:${ORDER_ID}`;
const LOCK_KEY = `otp:locked:${ORDER_ID}`;

/** Returns a minimal PrismaTransactionClient mock with an active OTP. */
function makeTx(
  overrides?: Partial<{
    otpCodeHash: string | null;
    otpExpiresAt: Date;
    pickupStatus: string;
  }>,
) {
  return {
    order: {
      findUnique: vi.fn().mockResolvedValue({
        otpCodeHash: CORRECT_HASH,
        otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        pickupStatus: "OTP_INITIATED",
        ...overrides,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

// ── Reset mocks before each test ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default happy-path Redis state: not locked, first attempt, all writes OK
  mockRedis.get.mockResolvedValue(null);
  mockRedis.incr.mockResolvedValue(1);
  mockRedis.expire.mockResolvedValue(1);
  mockRedis.set.mockResolvedValue("OK");
  mockRedis.del.mockResolvedValue(1);
});

// ── verifyOTP — attempt counting ──────────────────────────────────────────────

describe("verifyOTP — attempt counting", () => {
  it("first incorrect attempt returns error with 4 attempt(s) remaining", async () => {
    // incr returns 1 → this is the 1st of 5 attempts
    mockRedis.incr.mockResolvedValue(1);

    const result = await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: "999999", // wrong
      tx: makeTx() as never,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Incorrect code. 4 attempt(s) remaining.");
  });

  it("sets a TTL on the attempt key only on the first increment", async () => {
    mockRedis.incr.mockResolvedValue(1);

    await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: "999999",
      tx: makeTx() as never,
    });

    expect(mockRedis.expire).toHaveBeenCalledWith(ATTEMPT_KEY, 1800);
  });

  it("does not reset the TTL on subsequent failed attempts", async () => {
    // Simulate the 2nd incorrect attempt (counter is already at 2 after incr)
    mockRedis.incr.mockResolvedValue(2);

    await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: "000000",
      tx: makeTx() as never,
    });

    // expire should NOT be called because attempts !== 1
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it("third incorrect attempt reports 2 attempt(s) remaining", async () => {
    mockRedis.incr.mockResolvedValue(3);

    const result = await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: "111111",
      tx: makeTx() as never,
    });

    expect(result.error).toBe("Incorrect code. 2 attempt(s) remaining.");
  });
});

// ── verifyOTP — lockout on 5th incorrect attempt ──────────────────────────────

describe("verifyOTP — lockout", () => {
  it("5th incorrect attempt locks the order and returns the lockout message", async () => {
    mockRedis.incr.mockResolvedValue(5); // hits the OTP_MAX_ATTEMPTS threshold

    const result = await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: "000000",
      tx: makeTx() as never,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too many incorrect attempts/i);
  });

  it("sets the lock key in Redis with a 15-minute TTL on lockout", async () => {
    mockRedis.incr.mockResolvedValue(5);

    await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: "000000",
      tx: makeTx() as never,
    });

    expect(mockRedis.set).toHaveBeenCalledWith(LOCK_KEY, "1", { ex: 900 });
  });

  it("nulls the OTP hash in the database on lockout to force a fresh OTP", async () => {
    mockRedis.incr.mockResolvedValue(5);
    const tx = makeTx();

    await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: "000000",
      tx: tx as never,
    });

    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORDER_ID },
        data: expect.objectContaining({
          otpCodeHash: null,
          otpExpiresAt: null,
        }),
      }),
    );
  });

  it("rejects immediately when the lock key is already set (no hash comparison)", async () => {
    // Simulate an already-locked order
    mockRedis.get.mockResolvedValue("1");

    const result = await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: CORRECT_CODE, // even the correct code is rejected
      tx: makeTx() as never,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too many incorrect attempts/i);
    // Attempt counter must NOT be incremented — the order is already locked
    expect(mockRedis.incr).not.toHaveBeenCalled();
  });
});

// ── verifyOTP — correct code ──────────────────────────────────────────────────

describe("verifyOTP — correct code", () => {
  it("returns valid:true when the correct code is entered", async () => {
    const result = await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: CORRECT_CODE,
      tx: makeTx() as never,
    });

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("clears the attempt counter key in Redis after a correct code", async () => {
    await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: CORRECT_CODE,
      tx: makeTx() as never,
    });

    expect(mockRedis.del).toHaveBeenCalledWith(ATTEMPT_KEY);
  });

  it("does not increment the attempt counter on a correct code", async () => {
    await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: CORRECT_CODE,
      tx: makeTx() as never,
    });

    expect(mockRedis.incr).not.toHaveBeenCalled();
  });

  it("clears the OTP hash from the database after a correct code", async () => {
    const tx = makeTx();

    await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: CORRECT_CODE,
      tx: tx as never,
    });

    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORDER_ID },
        data: expect.objectContaining({
          otpCodeHash: null,
          otpExpiresAt: null,
        }),
      }),
    );
  });
});

// ── verifyOTP — Redis unavailable (fail-closed) ───────────────────────────────

describe("verifyOTP — fail-closed on Redis unavailability", () => {
  it("returns valid:false when Redis.get throws (cannot check lock)", async () => {
    mockRedis.get.mockRejectedValue(new Error("Redis connection refused"));

    const result = await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: CORRECT_CODE,
      tx: makeTx() as never,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/temporarily unavailable/i);
  });

  it("returns valid:false when Redis.incr throws (cannot track attempts)", async () => {
    mockRedis.incr.mockRejectedValue(new Error("Redis timeout"));

    const result = await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: "wrong-code",
      tx: makeTx() as never,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/temporarily unavailable/i);
  });

  it("never returns valid:true when Redis is unavailable, even for a correct code", async () => {
    mockRedis.get.mockRejectedValue(new Error("Network error"));

    const result = await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: CORRECT_CODE,
      tx: makeTx() as never,
    });

    // Fail-closed: correct code must NOT bypass a Redis failure
    expect(result.valid).toBe(false);
  });

  it("still returns valid:true when only the attempt-counter del fails (non-critical cleanup)", async () => {
    // get → null (not locked), incr not called for correct code
    // del fails — but this is best-effort cleanup, not fail-closed
    mockRedis.del.mockRejectedValue(new Error("Redis blip"));

    const result = await verifyOTP({
      orderId: ORDER_ID,
      enteredCode: CORRECT_CODE,
      tx: makeTx() as never,
    });

    // Cleanup failure must NOT prevent a valid verification from succeeding
    expect(result.valid).toBe(true);
  });
});

// ── generateAndSendOTP — Redis key cleanup ────────────────────────────────────

describe("generateAndSendOTP — clears lockout on new OTP", () => {
  it("deletes both the attempt counter and lock key when a new OTP is generated", async () => {
    const tx = {
      order: {
        update: vi.fn().mockResolvedValue({}),
      },
    };

    await generateAndSendOTP({
      orderId: ORDER_ID,
      buyerPhone: "+64211234567",
      buyerName: "Test Buyer",
      listingTitle: "Test Item",
      tx: tx as never,
    });

    expect(mockRedis.del).toHaveBeenCalledWith(ATTEMPT_KEY, LOCK_KEY);
  });

  it("returns success:true even when Redis.del throws during cleanup", async () => {
    mockRedis.del.mockRejectedValue(new Error("Redis down"));

    const tx = {
      order: {
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const result = await generateAndSendOTP({
      orderId: ORDER_ID,
      buyerPhone: "+64211234567",
      buyerName: "Test Buyer",
      listingTitle: "Test Item",
      tx: tx as never,
    });

    // Redis cleanup failure must not block OTP generation
    expect(result.success).toBe(true);
  });
});
