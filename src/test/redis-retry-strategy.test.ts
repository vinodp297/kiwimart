// src/test/redis-retry-strategy.test.ts
// ─── Unit tests for queueRetryStrategy ───────────────────────────────────────
// Verifies that the IORedis retry function never gives up and caps correctly.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../test/setup";

// Mock logger before importing the module under test
vi.mock("@/shared/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Mock IORedis so the module can load without a real Redis connection
vi.mock("ioredis", () => {
  const MockIORedis = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
  }));
  return { default: MockIORedis };
});

const { queueRetryStrategy } = await import("@/infrastructure/queue/client");
const { logger } = await import("@/shared/logger");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("queueRetryStrategy", () => {
  it("never returns null — retries indefinitely", () => {
    // Test a wide range of attempt counts including very high values
    const attempts = [1, 2, 3, 4, 5, 10, 20, 50, 100, 1000];
    for (const times of attempts) {
      const result = queueRetryStrategy(times);
      expect(
        result,
        `Expected non-null delay at attempt ${times}`,
      ).not.toBeNull();
      expect(typeof result).toBe("number");
    }
  });

  it("caps delay at 5000 ms regardless of attempt count", () => {
    // At attempt 25, uncapped would be 25 * 200 = 5000 ms (exactly at cap)
    expect(queueRetryStrategy(25)).toBe(5000);
    // Beyond the cap: still 5000 ms
    expect(queueRetryStrategy(26)).toBe(5000);
    expect(queueRetryStrategy(100)).toBe(5000);
    expect(queueRetryStrategy(1000)).toBe(5000);
  });

  it("uses linear backoff up to the cap (200 ms × attempt)", () => {
    expect(queueRetryStrategy(1)).toBe(200);
    expect(queueRetryStrategy(2)).toBe(400);
    expect(queueRetryStrategy(5)).toBe(1000);
    expect(queueRetryStrategy(10)).toBe(2000);
    expect(queueRetryStrategy(24)).toBe(4800);
  });

  it("logs a warn on every retry attempt", () => {
    queueRetryStrategy(3);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "redis.reconnecting",
      expect.objectContaining({ attempt: 3, delayMs: 600 }),
    );
  });

  it("warn log includes both attempt number and computed delay", () => {
    queueRetryStrategy(10);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith("redis.reconnecting", {
      attempt: 10,
      delayMs: 2000,
    });
  });
});
