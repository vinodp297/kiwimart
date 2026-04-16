// src/test/webhook-redis-fastpath.test.ts
// ─── Tests: WebhookService.processEvent() — handler + DB idempotency ────────
// The service-level Redis fast-path (webhook:seen:{id}) has been removed.
// Redis idempotency is now the sole responsibility of the route handler
// (webhook:stripe:{id}, 72 h TTL).
//
// This file verifies the service-level behaviour:
//   1. Handler runs and markEventProcessed (DB) is called on first delivery
//   2. Handler throws → markEventProcessed NOT called, error re-thrown (retry)
//   3. Concurrent duplicate (P2002) → handler ran idempotently, concurrent_duplicate logged
//   4. processEvent does NOT call getRedisClient (Redis is route's responsibility)
//   5. Handler failure logs stripe.webhook.handler_failed

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  mockCreateStripeEvent,
} = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  mockCreateStripeEvent: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/shared/logger", () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

vi.mock("@/server/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    createStripeEvent: (...args: unknown[]) => mockCreateStripeEvent(...args),
    $transaction: vi
      .fn()
      .mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
    updatePayoutByTransferId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    updateByStripeAccountId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/listings/listing.repository", () => ({
  listingRepository: {
    releaseReservation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn().mockResolvedValue(undefined) },
  ORDER_EVENT_TYPES: {
    PAYMENT_HELD: "PAYMENT_HELD",
    CANCELLED: "CANCELLED",
  },
  ACTOR_ROLES: { SYSTEM: "SYSTEM" },
}));

// ── Import service after mocks ─────────────────────────────────────────────────

import { WebhookService } from "@/modules/payments/webhook.service";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(id = "evt_test_001", type = "account.updated") {
  return {
    id,
    type,
    data: {
      object: {
        id: "acct_test",
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
      },
    },
  } as unknown as import("stripe").Stripe.Event;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WebhookService.processEvent — handler + DB idempotency (no service Redis)", () => {
  let service: WebhookService;

  beforeEach(() => {
    service = new WebhookService();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
    mockCreateStripeEvent.mockReset();
    // Default: DB mark succeeds (first delivery)
    mockCreateStripeEvent.mockResolvedValue(undefined);
  });

  it("first delivery: handler runs and markEventProcessed (DB) is called", async () => {
    const event = makeEvent("evt_first");
    await service.processEvent(event);

    // Handler ran — markEventProcessed recorded the event in DB
    expect(mockCreateStripeEvent).toHaveBeenCalledOnce();
    expect(mockCreateStripeEvent).toHaveBeenCalledWith(
      "evt_first",
      "account.updated",
    );
  });

  it("handler throws: markEventProcessed is NOT called and error is re-thrown", async () => {
    const { userRepository } = await import("@/modules/users/user.repository");
    vi.mocked(
      (userRepository as { updateByStripeAccountId: ReturnType<typeof vi.fn> })
        .updateByStripeAccountId,
    ).mockRejectedValueOnce(new Error("DB error"));

    const event = makeEvent("evt_handler_fail");
    await expect(service.processEvent(event)).rejects.toThrow("DB error");

    // markEventProcessed must NOT be called — Stripe needs to retry
    expect(mockCreateStripeEvent).not.toHaveBeenCalled();
  });

  it("handler failure is logged as stripe.webhook.handler_failed", async () => {
    const { userRepository } = await import("@/modules/users/user.repository");
    vi.mocked(
      (userRepository as { updateByStripeAccountId: ReturnType<typeof vi.fn> })
        .updateByStripeAccountId,
    ).mockRejectedValueOnce(new Error("upstream failure"));

    const event = makeEvent("evt_fail_log");
    await expect(service.processEvent(event)).rejects.toThrow();

    expect(mockLoggerError).toHaveBeenCalledWith(
      "stripe.webhook.handler_failed",
      expect.objectContaining({ eventId: "evt_fail_log" }),
    );
  });

  it("concurrent duplicate (P2002): handler ran idempotently, concurrent_duplicate logged", async () => {
    // Simulate DB unique constraint violation — another delivery already recorded the event
    const p2002Error = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    mockCreateStripeEvent.mockRejectedValueOnce(p2002Error);

    const event = makeEvent("evt_concurrent");
    // Must NOT throw — P2002 is handled gracefully
    await expect(service.processEvent(event)).resolves.toBeUndefined();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "stripe.webhook.concurrent_duplicate",
      expect.objectContaining({ eventId: "evt_concurrent" }),
    );
  });

  it("processEvent does not import or call getRedisClient (Redis is route responsibility)", async () => {
    // Verify the service source no longer contains getRedisClient
    const fs = await import("fs");
    const src = fs.readFileSync(
      "src/modules/payments/webhook.service.ts",
      "utf8",
    );
    expect(src).not.toContain("getRedisClient");
  });

  it("markEventProcessed returns true for new events, false for P2002", async () => {
    // New event
    mockCreateStripeEvent.mockResolvedValueOnce(undefined);
    const isNew = await service.markEventProcessed(
      "evt_new",
      "account.updated",
    );
    expect(isNew).toBe(true);

    // Duplicate (P2002)
    const p2002 = Object.assign(new Error("Unique constraint"), {
      code: "P2002",
    });
    mockCreateStripeEvent.mockRejectedValueOnce(p2002);
    const isDupe = await service.markEventProcessed(
      "evt_dupe",
      "account.updated",
    );
    expect(isDupe).toBe(false);
  });

  it("processEvent completes for unhandled event type without throwing", async () => {
    const unknownEvent = makeEvent("evt_unknown", "unknown.event.type");
    await expect(service.processEvent(unknownEvent)).resolves.toBeUndefined();

    // Warn logged for unhandled type
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "webhook.unhandled_event_type",
      expect.objectContaining({ eventType: "unknown.event.type" }),
    );

    // DB still recorded it (handler completed without throwing)
    expect(mockCreateStripeEvent).toHaveBeenCalledOnce();
  });
});
