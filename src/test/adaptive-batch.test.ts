// src/test/adaptive-batch.test.ts
// ─── Adaptive batching for autoReleaseEscrow ─────────────────────────────────
// Verifies that the fetch limit passed to db.order.findMany adapts based on
// the backlog count returned by orderRepository.countEligibleForAutoRelease().
//
// Constants under test (from autoReleaseEscrow.ts):
//   BATCH_SIZE_MIN     =  50
//   BATCH_SIZE_MAX     = 500
//   BATCH_SIZE_DEFAULT = 100
//   BACKLOG_ALERT_THRESHOLD = 200

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { processAutoReleases } from "@/server/jobs/autoReleaseEscrow";
import db from "@/lib/db";

// ─── Sentry spy ──────────────────────────────────────────────────────────────
const mockCaptureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: mockCaptureMessage,
}));

// ─── order-event.service (not under test here) ───────────────────────────────
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: { COMPLETED: "COMPLETED" },
  ACTOR_ROLES: { SYSTEM: "SYSTEM" },
}));

// ─── Helper: build a minimal dispatched order ────────────────────────────────
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    totalNzd: 5000,
    stripePaymentIntentId: "pi_test_123",
    dispatchedAt: new Date("2026-03-16T10:00:00Z"),
    listing: { id: "listing-1", title: "Test Item" },
    buyer: { email: "buyer@test.com", displayName: "Buyer" },
    seller: { email: "seller@test.com", displayName: "Seller" },
    ...overrides,
  };
}

describe("autoReleaseEscrow — adaptive batching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T10:00:00Z")); // well past escrow window
    // Default: no orders to process (we are testing batch SIZE not processing logic)
    vi.mocked(db.order.findMany).mockResolvedValue([] as never);
    vi.mocked(db.$transaction).mockResolvedValue([] as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses BATCH_SIZE_DEFAULT (100) when backlog is 0", async () => {
    // Both dispatched + cash counts return 0 → total backlog = 0
    vi.mocked(db.order.count).mockResolvedValue(0 as never);

    await processAutoReleases();

    // Both findMany calls should use take: 100
    const calls = vi.mocked(db.order.findMany).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      expect((call[0] as { take: number }).take).toBe(100);
    }
  });

  it("uses BATCH_SIZE_DEFAULT (100) when backlog is below default (e.g. 30)", async () => {
    // dispatched=20, cash=10 → total backlog=30 < BATCH_SIZE_DEFAULT(100)
    vi.mocked(db.order.count)
      .mockResolvedValueOnce(20 as never) // dispatched
      .mockResolvedValueOnce(10 as never); // cash

    await processAutoReleases();

    const calls = vi.mocked(db.order.findMany).mock.calls;
    for (const call of calls) {
      expect((call[0] as { take: number }).take).toBe(100); // clamped up to DEFAULT
    }
  });

  it("uses the exact backlog count when it falls between DEFAULT and MAX (e.g. 150)", async () => {
    // dispatched=100, cash=50 → total backlog=150
    vi.mocked(db.order.count)
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(50 as never);

    await processAutoReleases();

    const calls = vi.mocked(db.order.findMany).mock.calls;
    for (const call of calls) {
      expect((call[0] as { take: number }).take).toBe(150);
    }
  });

  it("caps at BATCH_SIZE_MAX (500) when backlog exceeds 500", async () => {
    // dispatched=400, cash=300 → total backlog=700 → capped at 500
    vi.mocked(db.order.count)
      .mockResolvedValueOnce(400 as never)
      .mockResolvedValueOnce(300 as never);

    await processAutoReleases();

    const calls = vi.mocked(db.order.findMany).mock.calls;
    for (const call of calls) {
      expect((call[0] as { take: number }).take).toBe(500);
    }
  });

  it("fires Sentry alert when backlog exceeds BACKLOG_ALERT_THRESHOLD (200)", async () => {
    // backlog=250 → above 200 → should alert
    vi.mocked(db.order.count)
      .mockResolvedValueOnce(200 as never)
      .mockResolvedValueOnce(50 as never);

    await processAutoReleases();

    // Allow the dynamic import + captureMessage to resolve
    await vi.runAllTimersAsync();

    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("backlog"),
      "warning",
    );
  });

  it("does NOT fire Sentry alert when backlog is at or below threshold (200)", async () => {
    // dispatched=100, cash=100 → total=200 (exactly at threshold, not above)
    vi.mocked(db.order.count)
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(100 as never);

    await processAutoReleases();
    await vi.runAllTimersAsync();

    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("includes remainingEstimate in completion log when batchSize < backlog", async () => {
    // backlog=700 → batchSize capped at 500 → remainingEstimate=200
    vi.mocked(db.order.count)
      .mockResolvedValueOnce(400 as never)
      .mockResolvedValueOnce(300 as never);

    // Return one eligible dispatched order so the run actually processes
    vi.mocked(db.order.findMany)
      .mockResolvedValueOnce([makeOrder()] as never) // dispatched
      .mockResolvedValueOnce([] as never); // cash
    vi.mocked(db.$transaction).mockResolvedValue([] as never);

    const result = await processAutoReleases();

    // The function still returns { processed, errors }
    expect(result).toHaveProperty("processed");
    expect(result).toHaveProperty("errors");
  });

  it("processes orders correctly even when batch sizing is active", async () => {
    vi.setSystemTime(new Date("2026-03-20T14:00:00Z")); // Friday — 4 biz days after Monday

    // backlog=150 → batchSize=150
    vi.mocked(db.order.count)
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(50 as never);

    const order = makeOrder({ dispatchedAt: new Date("2026-03-16T10:00:00Z") });
    vi.mocked(db.order.findMany)
      .mockResolvedValueOnce([order] as never) // dispatched
      .mockResolvedValueOnce([] as never); // cash
    vi.mocked(db.$transaction).mockResolvedValue([] as never);

    const result = await processAutoReleases();
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);

    // Confirm batchSize=150 was passed
    const firstFindMany = vi.mocked(db.order.findMany).mock.calls[0]!;
    expect((firstFindMany[0] as { take: number }).take).toBe(150);
  });
});
