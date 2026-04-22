// src/test/stripe-circuit-breaker.test.ts
// ─── Unit tests for Stripe circuit breaker ────────────────────────────────────
// Covers all state transitions:
//   CLOSED → normal operation → OPEN after FAILURE_THRESHOLD failures
//   OPEN   → immediate rejection
//   OPEN   → HALF-OPEN after RECOVERY_TIMEOUT_MS elapses
//   HALF-OPEN → CLOSED after SUCCESS_THRESHOLD successes
//   HALF-OPEN → OPEN on first failure
//   Redis unavailable → fail-open (fn always called)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/shared/errors";

// ── Redis mock ────────────────────────────────────────────────────────────────

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();
const mockIncr = vi.fn();
const mockExpire = vi.fn();

const mockRedis = {
  get: mockGet,
  set: mockSet,
  del: mockDel,
  incr: mockIncr,
  expire: mockExpire,
};

const mockGetRedisClient = vi.fn(() => mockRedis);

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => mockGetRedisClient(),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────

vi.mock("@/shared/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

const {
  withStripeCircuitBreaker,
  FAILURE_THRESHOLD,
  SUCCESS_THRESHOLD,
  RECOVERY_TIMEOUT_MS,
  FAILURE_TTL_SECONDS,
  KEYS,
} = await import("@/infrastructure/stripe/circuit-breaker");

const { logger } = await import("@/shared/logger");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns an ISO timestamp that is `ms` milliseconds in the past. */
function timestampMsAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default Redis state: circuit closed (state key absent)
  mockGet.mockResolvedValue(null);
  mockSet.mockResolvedValue("OK");
  mockDel.mockResolvedValue(1);
  mockIncr.mockResolvedValue(1);
  mockExpire.mockResolvedValue(1);
  mockGetRedisClient.mockReturnValue(mockRedis);
});

// ── CLOSED state ──────────────────────────────────────────────────────────────

describe("CLOSED state", () => {
  it("calls fn() and returns its result", async () => {
    mockGet.mockResolvedValue(null); // no state stored → closed

    const fn = vi.fn().mockResolvedValue({ id: "pi_123" });
    const result = await withStripeCircuitBreaker(fn, "paymentIntents.create");

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: "pi_123" });
  });

  it('calls fn() when state is explicitly stored as "closed"', async () => {
    mockGet.mockResolvedValue("closed");

    const fn = vi.fn().mockResolvedValue("ok");
    await withStripeCircuitBreaker(fn, "refunds.create");

    expect(fn).toHaveBeenCalledOnce();
  });

  it("re-throws the original error on failure without opening the circuit below threshold", async () => {
    const stripeErr = new Error("card_declined");
    const fn = vi.fn().mockRejectedValue(stripeErr);
    mockIncr.mockResolvedValue(1); // below FAILURE_THRESHOLD

    await expect(
      withStripeCircuitBreaker(fn, "paymentIntents.capture"),
    ).rejects.toThrow("card_declined");

    // Circuit should NOT have been opened yet
    expect(mockSet).not.toHaveBeenCalledWith(KEYS.state, "open");
  });

  it("records last-failure timestamp when a failure occurs", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("network error"));
    mockIncr.mockResolvedValue(1);

    await expect(
      withStripeCircuitBreaker(fn, "paymentIntents.create"),
    ).rejects.toThrow();

    expect(mockSet).toHaveBeenCalledWith(
      KEYS.lastFailure,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it("applies FAILURE_TTL_SECONDS rolling TTL to the failure counter", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("err"));
    mockIncr.mockResolvedValue(1);

    await expect(
      withStripeCircuitBreaker(fn, "paymentIntents.create"),
    ).rejects.toThrow();

    expect(mockExpire).toHaveBeenCalledWith(KEYS.failures, FAILURE_TTL_SECONDS);
  });
});

// ── CLOSED → OPEN transition ──────────────────────────────────────────────────

describe("CLOSED → OPEN transition", () => {
  it(`opens the circuit after ${FAILURE_THRESHOLD} consecutive failures`, async () => {
    let count = 0;
    mockIncr.mockImplementation(() => Promise.resolve(++count));

    const fn = vi.fn().mockRejectedValue(new Error("Stripe down"));

    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await expect(
        withStripeCircuitBreaker(fn, "paymentIntents.create"),
      ).rejects.toThrow("Stripe down");
    }

    expect(mockSet).toHaveBeenCalledWith(KEYS.state, "open");
  });

  it("logs stripe.circuit.opened with failure count when threshold is reached", async () => {
    let count = 0;
    mockIncr.mockImplementation(() => Promise.resolve(++count));

    const fn = vi.fn().mockRejectedValue(new Error("Stripe down"));

    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await expect(
        withStripeCircuitBreaker(fn, "transfers.create"),
      ).rejects.toThrow();
    }

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "stripe.circuit.opened",
      expect.objectContaining({
        failures: FAILURE_THRESHOLD,
        operationName: "transfers.create",
      }),
    );
  });

  it("does not open the circuit on the (FAILURE_THRESHOLD - 1)th failure", async () => {
    let count = 0;
    mockIncr.mockImplementation(() => Promise.resolve(++count));

    const fn = vi.fn().mockRejectedValue(new Error("err"));

    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      await expect(
        withStripeCircuitBreaker(fn, "paymentIntents.create"),
      ).rejects.toThrow();
    }

    expect(mockSet).not.toHaveBeenCalledWith(KEYS.state, "open");
  });
});

// ── OPEN state ────────────────────────────────────────────────────────────────

describe("OPEN state", () => {
  it("rejects immediately without calling fn()", async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === KEYS.state) return Promise.resolve("open");
      if (key === KEYS.lastFailure)
        return Promise.resolve(new Date().toISOString());
      return Promise.resolve(null);
    });

    const fn = vi.fn().mockResolvedValue({});

    await expect(
      withStripeCircuitBreaker(fn, "paymentIntents.capture"),
    ).rejects.toMatchObject({
      code: "PAYMENT_GATEWAY_UNAVAILABLE",
      statusCode: 503,
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it("throws an AppError instance", async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === KEYS.state) return Promise.resolve("open");
      if (key === KEYS.lastFailure)
        return Promise.resolve(new Date().toISOString());
      return Promise.resolve(null);
    });

    const fn = vi.fn();

    await expect(
      withStripeCircuitBreaker(fn, "refunds.create"),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("logs stripe.circuit.rejected with operationName", async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === KEYS.state) return Promise.resolve("open");
      if (key === KEYS.lastFailure)
        return Promise.resolve(new Date().toISOString());
      return Promise.resolve(null);
    });

    const fn = vi.fn();

    await expect(
      withStripeCircuitBreaker(fn, "transfers.create"),
    ).rejects.toThrow();

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "stripe.circuit.rejected",
      expect.objectContaining({
        operationName: "transfers.create",
        state: "open",
      }),
    );
  });
});

// ── OPEN → HALF-OPEN transition ───────────────────────────────────────────────

describe("OPEN → HALF-OPEN transition", () => {
  it(`transitions to HALF-OPEN after ${RECOVERY_TIMEOUT_MS}ms and allows a probe`, async () => {
    const oldTimestamp = timestampMsAgo(RECOVERY_TIMEOUT_MS + 5_000);

    mockGet.mockImplementation((key: string) => {
      if (key === KEYS.state) return Promise.resolve("open");
      if (key === KEYS.lastFailure) return Promise.resolve(oldTimestamp);
      return Promise.resolve(null);
    });

    const fn = vi.fn().mockResolvedValue({ id: "pi_probe" });

    const result = await withStripeCircuitBreaker(fn, "paymentIntents.create");

    // State should have been flipped to half-open
    expect(mockSet).toHaveBeenCalledWith(KEYS.state, "half-open");
    // fn should have been called (the probe)
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: "pi_probe" });
  });

  it("stays OPEN when recovery timeout has not yet elapsed", async () => {
    const recentTimestamp = timestampMsAgo(RECOVERY_TIMEOUT_MS - 10_000);

    mockGet.mockImplementation((key: string) => {
      if (key === KEYS.state) return Promise.resolve("open");
      if (key === KEYS.lastFailure) return Promise.resolve(recentTimestamp);
      return Promise.resolve(null);
    });

    const fn = vi.fn();

    await expect(
      withStripeCircuitBreaker(fn, "paymentIntents.create"),
    ).rejects.toMatchObject({ code: "PAYMENT_GATEWAY_UNAVAILABLE" });

    // Should NOT have transitioned to half-open
    expect(mockSet).not.toHaveBeenCalledWith(KEYS.state, "half-open");
    expect(fn).not.toHaveBeenCalled();
  });

  it("resets the success counter when transitioning to HALF-OPEN", async () => {
    const oldTimestamp = timestampMsAgo(RECOVERY_TIMEOUT_MS + 1_000);

    mockGet.mockImplementation((key: string) => {
      if (key === KEYS.state) return Promise.resolve("open");
      if (key === KEYS.lastFailure) return Promise.resolve(oldTimestamp);
      return Promise.resolve(null);
    });

    const fn = vi.fn().mockResolvedValue({});

    await withStripeCircuitBreaker(fn, "paymentIntents.create");

    expect(mockDel).toHaveBeenCalledWith(KEYS.successes);
  });
});

// ── HALF-OPEN state ───────────────────────────────────────────────────────────

describe("HALF-OPEN state", () => {
  it("calls fn() (probe) when circuit is HALF-OPEN", async () => {
    mockGet.mockResolvedValue("half-open");
    const fn = vi.fn().mockResolvedValue({ id: "pi_probe" });

    const result = await withStripeCircuitBreaker(fn, "paymentIntents.create");

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: "pi_probe" });
  });

  it("logs stripe.circuit.half_open with operationName", async () => {
    mockGet.mockResolvedValue("half-open");
    mockIncr.mockResolvedValue(1);
    const fn = vi.fn().mockResolvedValue({});

    await withStripeCircuitBreaker(fn, "transfers.create");

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "stripe.circuit.half_open",
      expect.objectContaining({ operationName: "transfers.create" }),
    );
  });
});

// ── HALF-OPEN → CLOSED transition ─────────────────────────────────────────────

describe("HALF-OPEN → CLOSED transition", () => {
  it(`closes the circuit after ${SUCCESS_THRESHOLD} consecutive successes`, async () => {
    mockGet.mockResolvedValue("half-open");
    let count = 0;
    mockIncr.mockImplementation(() => Promise.resolve(++count));

    const fn = vi.fn().mockResolvedValue({ id: "pi_ok" });

    for (let i = 0; i < SUCCESS_THRESHOLD; i++) {
      await withStripeCircuitBreaker(fn, "paymentIntents.create");
    }

    expect(mockSet).toHaveBeenCalledWith(KEYS.state, "closed");
  });

  it("clears failure, lastFailure and success counters on close", async () => {
    mockGet.mockResolvedValue("half-open");
    let count = 0;
    mockIncr.mockImplementation(() => Promise.resolve(++count));

    const fn = vi.fn().mockResolvedValue({});

    for (let i = 0; i < SUCCESS_THRESHOLD; i++) {
      await withStripeCircuitBreaker(fn, "paymentIntents.create");
    }

    expect(mockDel).toHaveBeenCalledWith(KEYS.failures);
    expect(mockDel).toHaveBeenCalledWith(KEYS.lastFailure);
    expect(mockDel).toHaveBeenCalledWith(KEYS.successes);
  });

  it("logs stripe.circuit.closed with operationName", async () => {
    mockGet.mockResolvedValue("half-open");
    let count = 0;
    mockIncr.mockImplementation(() => Promise.resolve(++count));

    const fn = vi.fn().mockResolvedValue({});

    for (let i = 0; i < SUCCESS_THRESHOLD; i++) {
      await withStripeCircuitBreaker(fn, "transfers.create");
    }

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "stripe.circuit.closed",
      expect.objectContaining({ operationName: "transfers.create" }),
    );
  });

  it("does not close on the first success alone (below SUCCESS_THRESHOLD)", async () => {
    mockGet.mockResolvedValue("half-open");
    mockIncr.mockResolvedValue(SUCCESS_THRESHOLD - 1); // below threshold

    const fn = vi.fn().mockResolvedValue({});
    await withStripeCircuitBreaker(fn, "paymentIntents.create");

    expect(mockSet).not.toHaveBeenCalledWith(KEYS.state, "closed");
  });
});

// ── HALF-OPEN → OPEN transition ───────────────────────────────────────────────

describe("HALF-OPEN → OPEN transition", () => {
  it("immediately re-opens the circuit on any failure in HALF-OPEN state", async () => {
    mockGet.mockResolvedValue("half-open");
    const fn = vi.fn().mockRejectedValue(new Error("Stripe blip"));

    await expect(
      withStripeCircuitBreaker(fn, "paymentIntents.capture"),
    ).rejects.toThrow("Stripe blip");

    expect(mockSet).toHaveBeenCalledWith(KEYS.state, "open");
  });

  it("records last-failure timestamp when re-opening from HALF-OPEN", async () => {
    mockGet.mockResolvedValue("half-open");
    const fn = vi.fn().mockRejectedValue(new Error("err"));

    await expect(
      withStripeCircuitBreaker(fn, "paymentIntents.capture"),
    ).rejects.toThrow();

    expect(mockSet).toHaveBeenCalledWith(
      KEYS.lastFailure,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it("resets success counter when re-opening from HALF-OPEN", async () => {
    mockGet.mockResolvedValue("half-open");
    const fn = vi.fn().mockRejectedValue(new Error("err"));

    await expect(
      withStripeCircuitBreaker(fn, "paymentIntents.capture"),
    ).rejects.toThrow();

    expect(mockDel).toHaveBeenCalledWith(KEYS.successes);
  });

  it("logs stripe.circuit.opened with FAILURE_THRESHOLD failures when re-opening", async () => {
    mockGet.mockResolvedValue("half-open");
    const fn = vi.fn().mockRejectedValue(new Error("err"));

    await expect(
      withStripeCircuitBreaker(fn, "transfers.create"),
    ).rejects.toThrow();

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "stripe.circuit.opened",
      expect.objectContaining({
        failures: FAILURE_THRESHOLD,
        operationName: "transfers.create",
      }),
    );
  });
});

// ── Redis unavailable ─────────────────────────────────────────────────────────

describe("Redis unavailable (fail-open)", () => {
  it("calls fn() directly when getRedisClient() throws", async () => {
    mockGetRedisClient.mockImplementationOnce(() => {
      throw new Error("Redis connection refused");
    });

    const fn = vi.fn().mockResolvedValue({ id: "pi_fallback" });

    const result = await withStripeCircuitBreaker(fn, "paymentIntents.create");

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: "pi_fallback" });
  });

  it("logs stripe.circuit_breaker.redis_unavailable when Redis is down", async () => {
    mockGetRedisClient.mockImplementationOnce(() => {
      throw new Error("Redis unreachable");
    });

    const fn = vi.fn().mockResolvedValue({});
    await withStripeCircuitBreaker(fn, "transfers.create");

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "stripe.circuit_breaker.redis_unavailable",
    );
  });

  it("propagates fn() rejection when Redis is down (fail-open does not swallow errors)", async () => {
    mockGetRedisClient.mockImplementationOnce(() => {
      throw new Error("Redis unreachable");
    });

    const stripeErr = new Error("card_declined");
    const fn = vi.fn().mockRejectedValue(stripeErr);

    await expect(
      withStripeCircuitBreaker(fn, "paymentIntents.capture"),
    ).rejects.toThrow("card_declined");
  });

  it("calls fn() directly when redis.get() rejects during state resolution", async () => {
    mockGet.mockRejectedValueOnce(new Error("Upstash timeout"));

    const fn = vi.fn().mockResolvedValue({ id: "pi_ok" });
    const result = await withStripeCircuitBreaker(fn, "paymentIntents.create");

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: "pi_ok" });
  });
});
