// src/test/queue-configs.test.ts
// ─── Per-queue job configuration invariants ───────────────────────────────────
// Tests the exported queue config constants directly.
// Does NOT import setup.ts — that global mock replaces @/lib/queue entirely,
// which would strip the config constants. Instead, only the two external
// dependencies of queue.ts (BullMQ and the Redis client) are mocked here.

import { describe, it, expect, vi, afterEach } from "vitest";

// Prevent the Queue constructor from trying to open a real Redis connection.
vi.mock("bullmq", () => ({
  Queue: class MockQueue {
    constructor() {}
    add = vi.fn();
    close = vi.fn();
  },
}));

// Prevent getQueueConnection() from throwing when REDIS_URL is absent.
vi.mock("@/infrastructure/queue/client", () => ({
  getQueueConnection: vi.fn().mockReturnValue({}),
}));

// The global setup.ts mocks @/lib/queue as a thin object that strips all config
// constants. Override it here with importOriginal so the real per-queue config
// objects are accessible. Queue instances use lazy Proxy objects and will not
// touch Redis unless a method is actually called — safe for this test.
vi.mock("@/lib/queue", async (importOriginal) => {
  return importOriginal<typeof import("@/lib/queue")>();
});

import {
  DEFAULT_JOB_OPTIONS,
  EMAIL_QUEUE_CONFIG,
  IMAGE_QUEUE_CONFIG,
  PAYOUT_QUEUE_CONFIG,
  NOTIFICATION_QUEUE_CONFIG,
  PICKUP_QUEUE_CONFIG,
} from "@/lib/queue";

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Backward-compat: DEFAULT_JOB_OPTIONS unchanged ───────────────────────────

describe("DEFAULT_JOB_OPTIONS — backward compatibility", () => {
  it("retains attempts:3", () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
  });

  it("retains exponential backoff starting at 5,000 ms", () => {
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({
      type: "exponential",
      delay: 5000,
    });
  });

  it("retains removeOnComplete: { count: 100 }", () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({ count: 100 });
  });

  it("retains removeOnFail: false for dead-letter queue retention", () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBe(false);
  });
});

// ── Shared invariants across all per-queue configs ────────────────────────────

const ALL_CONFIGS = [
  { name: "EMAIL_QUEUE_CONFIG", config: EMAIL_QUEUE_CONFIG },
  { name: "IMAGE_QUEUE_CONFIG", config: IMAGE_QUEUE_CONFIG },
  { name: "PAYOUT_QUEUE_CONFIG", config: PAYOUT_QUEUE_CONFIG },
  { name: "NOTIFICATION_QUEUE_CONFIG", config: NOTIFICATION_QUEUE_CONFIG },
  { name: "PICKUP_QUEUE_CONFIG", config: PICKUP_QUEUE_CONFIG },
];

describe("all per-queue configs — shared invariants", () => {
  it.each(ALL_CONFIGS)(
    "$name uses custom backoff type for jitter support",
    ({ config }) => {
      expect(config.jobOptions.backoff.type).toBe("custom");
    },
  );

  it.each(ALL_CONFIGS)(
    "$name keeps failed jobs for DLQ inspection (removeOnFail: false)",
    ({ config }) => {
      expect(config.jobOptions.removeOnFail).toBe(false);
    },
  );

  it.each(ALL_CONFIGS)(
    "$name exports a backoffStrategy function",
    ({ config }) => {
      expect(config.backoffStrategy).toBeTypeOf("function");
    },
  );

  it.each(ALL_CONFIGS)(
    "$name backoffStrategy returns a positive finite number for attempt 0",
    ({ config }) => {
      const delay = config.backoffStrategy(0);
      expect(delay).toBeGreaterThan(0);
      expect(Number.isFinite(delay)).toBe(true);
    },
  );

  it.each(ALL_CONFIGS)(
    "$name backoffStrategy returns a larger delay for attempt 1 than attempt 0 (exponential growth)",
    ({ config }) => {
      // Pin Math.random() = 0 so jitter does not obscure the exponential comparison.
      vi.spyOn(Math, "random").mockReturnValue(0);
      const delay0 = config.backoffStrategy(0);
      const delay1 = config.backoffStrategy(1);
      expect(delay1).toBeGreaterThan(delay0);
    },
  );
});

// ── EMAIL_QUEUE_CONFIG ────────────────────────────────────────────────────────

describe("EMAIL_QUEUE_CONFIG", () => {
  it("has 5 attempts — allows several hours of Resend downtime before DLQ", () => {
    expect(EMAIL_QUEUE_CONFIG.jobOptions.attempts).toBe(5);
  });

  it("keeps last 100 completed jobs", () => {
    expect(EMAIL_QUEUE_CONFIG.jobOptions.removeOnComplete).toEqual({
      count: 100,
    });
  });

  it("backoffStrategy starts at ≥2,000 ms (base delay) with zero jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(EMAIL_QUEUE_CONFIG.backoffStrategy(0)).toBe(2000);
  });

  it("backoffStrategy for attempt 0 stays within [2000, 3000) with full jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9999);
    const delay = EMAIL_QUEUE_CONFIG.backoffStrategy(0);
    // base = 2000 * 2^0 = 2000, jitter upper = 1000 → max ≈ 3000
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThan(3001);
  });
});

// ── IMAGE_QUEUE_CONFIG ────────────────────────────────────────────────────────

describe("IMAGE_QUEUE_CONFIG", () => {
  it("has 3 attempts — sufficient for transient R2 upload errors", () => {
    expect(IMAGE_QUEUE_CONFIG.jobOptions.attempts).toBe(3);
  });

  it("keeps last 50 completed jobs", () => {
    expect(IMAGE_QUEUE_CONFIG.jobOptions.removeOnComplete).toEqual({
      count: 50,
    });
  });

  it("backoffStrategy starts at 3,000 ms with zero jitter (longer than email)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(IMAGE_QUEUE_CONFIG.backoffStrategy(0)).toBe(3000);
  });
});

// ── PAYOUT_QUEUE_CONFIG ───────────────────────────────────────────────────────

describe("PAYOUT_QUEUE_CONFIG", () => {
  it("has 5 attempts — covers multi-hour Stripe Connect outages", () => {
    expect(PAYOUT_QUEUE_CONFIG.jobOptions.attempts).toBe(5);
  });

  it("keeps last 500 completed jobs for audit trail", () => {
    expect(PAYOUT_QUEUE_CONFIG.jobOptions.removeOnComplete).toEqual({
      count: 500,
    });
  });

  it("backoffStrategy starts at 10,000 ms with zero jitter — longest base delay", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(PAYOUT_QUEUE_CONFIG.backoffStrategy(0)).toBe(10000);
  });

  it("backoffStrategy base delay exceeds EMAIL and IMAGE configs (financial safety)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const payoutDelay = PAYOUT_QUEUE_CONFIG.backoffStrategy(0);
    const emailDelay = EMAIL_QUEUE_CONFIG.backoffStrategy(0);
    const imageDelay = IMAGE_QUEUE_CONFIG.backoffStrategy(0);
    expect(payoutDelay).toBeGreaterThan(emailDelay);
    expect(payoutDelay).toBeGreaterThan(imageDelay);
  });
});

// ── NOTIFICATION_QUEUE_CONFIG ─────────────────────────────────────────────────

describe("NOTIFICATION_QUEUE_CONFIG", () => {
  it("has 3 attempts — best-effort delivery", () => {
    expect(NOTIFICATION_QUEUE_CONFIG.jobOptions.attempts).toBe(3);
  });

  it("keeps last 200 completed jobs", () => {
    expect(NOTIFICATION_QUEUE_CONFIG.jobOptions.removeOnComplete).toEqual({
      count: 200,
    });
  });

  it("backoffStrategy starts at 1,000 ms with zero jitter — fastest base delay", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(NOTIFICATION_QUEUE_CONFIG.backoffStrategy(0)).toBe(1000);
  });
});

// ── PICKUP_QUEUE_CONFIG ───────────────────────────────────────────────────────

describe("PICKUP_QUEUE_CONFIG", () => {
  it("has 3 attempts — sufficient for transient Redis blips during OTP flows", () => {
    expect(PICKUP_QUEUE_CONFIG.jobOptions.attempts).toBe(3);
  });

  it("keeps last 100 completed jobs", () => {
    expect(PICKUP_QUEUE_CONFIG.jobOptions.removeOnComplete).toEqual({
      count: 100,
    });
  });

  it("backoffStrategy starts at 2,000 ms with zero jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(PICKUP_QUEUE_CONFIG.backoffStrategy(0)).toBe(2000);
  });
});

// ── Jitter is non-deterministic but bounded ───────────────────────────────────

describe("backoffStrategy — jitter bounds", () => {
  it("EMAIL jitter is bounded between 0 and 1,000 ms", () => {
    // Run 20 samples — with real Math.random() all must fall within range
    for (let i = 0; i < 20; i++) {
      const delay = EMAIL_QUEUE_CONFIG.backoffStrategy(0);
      // base = 2000, max jitter = 1000 → [2000, 3000)
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThan(3001);
    }
  });

  it("PAYOUT jitter is bounded between 0 and 2,000 ms", () => {
    for (let i = 0; i < 20; i++) {
      const delay = PAYOUT_QUEUE_CONFIG.backoffStrategy(0);
      // base = 10000, max jitter = 2000 → [10000, 12000)
      expect(delay).toBeGreaterThanOrEqual(10000);
      expect(delay).toBeLessThan(12001);
    }
  });
});
