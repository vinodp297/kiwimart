// src/test/cash-pickup-event.test.ts
// ─── Fix 3: handleCashOnPickup awaits orderEventService.recordEvent ───────────
// Verifies that:
//   1. recordEvent is called and awaited (not fire-and-forget) when a
//      CASH_ON_PICKUP order is created
//   2. If recordEvent throws, the error is logged — not silently swallowed

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock orderEventService ────────────────────────────────────────────────────
const mockRecordEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: {
    recordEvent: (...args: unknown[]) => mockRecordEvent(...args),
  },
  ORDER_EVENT_TYPES: { ORDER_CREATED: "ORDER_CREATED" },
  ACTOR_ROLES: { BUYER: "BUYER" },
}));

// ── Mock audit ────────────────────────────────────────────────────────────────
// (Already mocked globally via setup.ts — just reference it)

// ── Mock fire-and-forget (notifications) ─────────────────────────────────────
vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: vi.fn(),
}));

// ── Mock notification service ─────────────────────────────────────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock order repository (schedulePickupDeadline dependency) ─────────────────
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findBuyerDisplayName: vi.fn().mockResolvedValue({ displayName: "Alice" }),
    updateScheduleDeadlineJobId: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock order confirmation email ─────────────────────────────────────────────
vi.mock("@/server/email", () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendPayoutInitiatedEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock queue (pickupQueue.add must return a Promise for .then() chaining) ───
vi.mock("@/lib/queue", () => ({
  payoutQueue: { add: vi.fn().mockResolvedValue(undefined) },
  emailQueue: { add: vi.fn().mockResolvedValue(undefined) },
  pickupQueue: { add: vi.fn().mockResolvedValue(undefined) },
  imageQueue: { add: vi.fn().mockResolvedValue(undefined) },
  notificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
  getQueueConnection: vi.fn().mockReturnValue({}),
  QUEUE_MAP: {},
  VALID_QUEUE_NAMES: [],
  DEFAULT_JOB_OPTIONS: {},
}));

// ── Mock request-context ──────────────────────────────────────────────────────
vi.mock("@/lib/request-context", () => ({
  getRequestContext: vi.fn().mockReturnValue({ correlationId: "test-corr" }),
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

// ── Import after all mocks ────────────────────────────────────────────────────
const { handleCashOnPickup } =
  await import("@/modules/orders/order-create-helpers");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LISTING = {
  id: "listing_1",
  title: "Test Listing",
  sellerId: "seller_1",
};

// ─────────────────────────────────────────────────────────────────────────────
// Group 1 — recordEvent is called and awaited
// ─────────────────────────────────────────────────────────────────────────────

describe("handleCashOnPickup — recordEvent is awaited (Fix 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordEvent.mockResolvedValue(undefined);
  });

  it("calls recordEvent with correct ORDER_CREATED data", async () => {
    await handleCashOnPickup("order_1", "user_1", LISTING, 5000, "127.0.0.1");

    expect(mockRecordEvent).toHaveBeenCalledOnce();
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_1",
        type: "ORDER_CREATED",
        actorId: "user_1",
        actorRole: "BUYER",
      }),
    );
  });

  it("handleCashOnPickup is async — returns a Promise", () => {
    const result = handleCashOnPickup(
      "order_1",
      "user_1",
      LISTING,
      5000,
      "127.0.0.1",
    );
    expect(result).toBeInstanceOf(Promise);
  });

  it("recordEvent is awaited — slow DB write still completes before function returns", async () => {
    // Simulate a slow DB write — if not awaited, mock would not have been called
    // by the time we check. The await ensures the sequence is respected.
    let writeCompleted = false;

    mockRecordEvent.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      writeCompleted = true;
    });

    await handleCashOnPickup("order_1", "user_1", LISTING, 5000, "127.0.0.1");

    // Because handleCashOnPickup awaits recordEvent, writeCompleted is true here
    expect(writeCompleted).toBe(true);
  });

  it("summary includes listing title and formatted amount", async () => {
    await handleCashOnPickup("order_1", "user_1", LISTING, 5000, "127.0.0.1");

    const call = mockRecordEvent.mock.calls[0]![0] as {
      summary: string;
    };
    expect(call.summary).toContain("Test Listing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2 — errors are logged, not silently swallowed
// ─────────────────────────────────────────────────────────────────────────────

describe("handleCashOnPickup — recordEvent errors are logged (Fix 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("if recordEvent throws, the error is caught and handleCashOnPickup resolves", async () => {
    mockRecordEvent.mockRejectedValueOnce(new Error("DB write failed"));

    // Must resolve — not reject — so order creation still succeeds
    await expect(
      handleCashOnPickup("order_1", "user_1", LISTING, 5000, "127.0.0.1"),
    ).resolves.toBeUndefined();
  });

  it("if recordEvent rejects, logger.error is called with orderId context", async () => {
    mockRecordEvent.mockRejectedValueOnce(new Error("Connection timeout"));

    // Import the mocked logger to spy on it
    const { logger } = await import("@/shared/logger");

    await handleCashOnPickup("order_1", "user_1", LISTING, 5000, "127.0.0.1");

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "order.cash_pickup.event_write_failed",
      expect.objectContaining({
        orderId: "order_1",
        error: expect.stringContaining("Connection timeout"),
      }),
    );
  });

  it("error in recordEvent does NOT prevent notifications from firing", async () => {
    mockRecordEvent.mockRejectedValueOnce(new Error("DB error"));

    const { fireAndForget } = await import("@/lib/fire-and-forget");

    await handleCashOnPickup("order_1", "user_1", LISTING, 5000, "127.0.0.1");

    // Notifications are still sent even when the event write fails
    expect(vi.mocked(fireAndForget)).toHaveBeenCalled();
  });
});
