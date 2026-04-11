// src/test/webhook-missing-handlers.test.ts
// ─── Tests: 7 missing Stripe webhook handlers ─────────────────────────────────
//   1.  charge.refunded → order transitioned to REFUNDED
//   2.  charge.refunded → idempotent on second call
//   3.  charge.dispute.created → Dispute row created
//   4.  charge.dispute.created → order transitioned to DISPUTED
//   5.  charge.dispute.closed won → order COMPLETED
//   6.  charge.dispute.closed lost → order REFUNDED
//   7.  payout.failed → payout marked FAILED
//   8.  payout.failed → error logged with requiresManualReconciliation
//   9.  transfer.failed → payout marked FAILED
//   10. payment_intent.canceled → order CANCELLED
//   11. payment_intent.canceled → listing released
//   12. Unknown event type → warning logged (not error)

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockRedisGet,
  mockRedisSet,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  mockCreateStripeEvent,
  mockFindByStripePaymentIntentId,
  mockFindForWebhookStatus,
  mockTransitionOrder,
  mockCreateDispute,
  mockFindDisputeByOrderId,
  mockUpdateDispute,
  mockFindByStripeTransferId,
  mockFindLatestProcessingByStripeAccount,
  mockMarkFailed,
  mockMarkReversed,
  mockReleaseReservation,
  mockRecordEvent,
  mockFireAndForget,
} = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  mockCreateStripeEvent: vi.fn(),
  mockFindByStripePaymentIntentId: vi.fn(),
  mockFindForWebhookStatus: vi.fn(),
  mockTransitionOrder: vi.fn(),
  mockCreateDispute: vi.fn(),
  mockFindDisputeByOrderId: vi.fn(),
  mockUpdateDispute: vi.fn(),
  mockFindByStripeTransferId: vi.fn(),
  mockFindLatestProcessingByStripeAccount: vi.fn(),
  mockMarkFailed: vi.fn(),
  mockMarkReversed: vi.fn(),
  mockReleaseReservation: vi.fn(),
  mockRecordEvent: vi.fn(),
  mockFireAndForget: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

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
    findByStripePaymentIntentId: (...args: unknown[]) =>
      mockFindByStripePaymentIntentId(...args),
    findForWebhookStatus: (...args: unknown[]) =>
      mockFindForWebhookStatus(...args),
    updatePayoutByTransferId: vi.fn().mockResolvedValue(undefined),
    $transaction: vi
      .fn()
      .mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
  },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: (...args: unknown[]) => mockTransitionOrder(...args),
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: {
    recordEvent: (...args: unknown[]) => mockRecordEvent(...args),
  },
  ORDER_EVENT_TYPES: {
    PAYMENT_HELD: "PAYMENT_HELD",
    CANCELLED: "CANCELLED",
    CHARGE_REFUNDED: "CHARGE_REFUNDED",
    CHARGEBACK_OPENED: "CHARGEBACK_OPENED",
    CHARGEBACK_RESOLVED: "CHARGEBACK_RESOLVED",
    PAYMENT_INTENT_CANCELLED: "PAYMENT_INTENT_CANCELLED",
  },
  ACTOR_ROLES: { SYSTEM: "SYSTEM" },
}));

vi.mock("@/modules/disputes/dispute.repository", () => ({
  disputeRepository: {
    findByOrderId: (...args: unknown[]) => mockFindDisputeByOrderId(...args),
    create: (...args: unknown[]) => mockCreateDispute(...args),
    update: (...args: unknown[]) => mockUpdateDispute(...args),
  },
}));

vi.mock("@/modules/payments/payout.repository", () => ({
  payoutRepository: {
    findByStripeTransferId: (...args: unknown[]) =>
      mockFindByStripeTransferId(...args),
    findLatestProcessingByStripeAccount: (...args: unknown[]) =>
      mockFindLatestProcessingByStripeAccount(...args),
    markFailed: (...args: unknown[]) => mockMarkFailed(...args),
    markReversed: (...args: unknown[]) => mockMarkReversed(...args),
  },
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    updateByStripeAccountId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/listings/listing.repository", () => ({
  listingRepository: {
    releaseReservation: (...args: unknown[]) => mockReleaseReservation(...args),
  },
}));

vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: (...args: unknown[]) => mockFireAndForget(...args),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// ── Import service after mocks ─────────────────────────────────────────────────

import { WebhookService } from "@/modules/payments/webhook.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService() {
  return new WebhookService();
}

function makeEvent(
  id: string,
  type: string,
  dataObject: Record<string, unknown>,
  account?: string,
) {
  return {
    id,
    type,
    account,
    data: { object: dataObject },
  } as unknown as import("stripe").Stripe.Event;
}

const BASE_ORDER = {
  id: "ord-001",
  status: "PAYMENT_HELD",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  listingId: "lst-1",
};

const BASE_DISPUTE = {
  id: "disp-001",
  orderId: "ord-001",
  status: "OPEN",
};

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Redis: first delivery (GET null, SET OK)
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue("OK");

  // DB mark as new event
  mockCreateStripeEvent.mockResolvedValue(undefined);

  // Default handler mocks
  mockFindByStripePaymentIntentId.mockResolvedValue(BASE_ORDER);
  mockFindForWebhookStatus.mockResolvedValue({
    status: "AWAITING_PAYMENT",
    fulfillmentType: "SHIPPED",
  });
  mockTransitionOrder.mockResolvedValue(undefined);
  mockRecordEvent.mockResolvedValue(undefined);
  mockFindDisputeByOrderId.mockResolvedValue(null); // no existing dispute
  mockCreateDispute.mockResolvedValue({ id: "disp-001" });
  mockUpdateDispute.mockResolvedValue({ id: "disp-001" });
  mockFindByStripeTransferId.mockResolvedValue({
    id: "payout-001",
    orderId: "ord-001",
    userId: "seller-1",
    status: "PROCESSING",
  });
  mockFindLatestProcessingByStripeAccount.mockResolvedValue({
    id: "payout-001",
    orderId: "ord-001",
    userId: "seller-1",
    status: "PROCESSING",
  });
  mockMarkFailed.mockResolvedValue(undefined);
  mockMarkReversed.mockResolvedValue(undefined);
  mockReleaseReservation.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1-2. charge.refunded
// ═══════════════════════════════════════════════════════════════════════════════

describe("charge.refunded handler", () => {
  function makeChargeRefundedEvent(piId = "pi_test_001") {
    return makeEvent("evt_refunded_001", "charge.refunded", {
      id: "ch_test_001",
      payment_intent: piId,
      amount_refunded: 5000,
    });
  }

  it("transitions order to REFUNDED when status is PAYMENT_HELD", async () => {
    mockFindByStripePaymentIntentId.mockResolvedValue({
      ...BASE_ORDER,
      status: "PAYMENT_HELD",
    });

    await makeService().processEvent(makeChargeRefundedEvent());

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "ord-001",
      "REFUNDED",
      expect.anything(),
      expect.objectContaining({ fromStatus: "PAYMENT_HELD" }),
    );
  });

  it("is idempotent — no transition if order already REFUNDED", async () => {
    mockFindByStripePaymentIntentId.mockResolvedValue({
      ...BASE_ORDER,
      status: "REFUNDED",
    });

    await makeService().processEvent(makeChargeRefundedEvent());

    expect(mockTransitionOrder).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3-4. charge.dispute.created
// ═══════════════════════════════════════════════════════════════════════════════

describe("charge.dispute.created handler", () => {
  function makeDisputeCreatedEvent() {
    return makeEvent("evt_dispute_created_001", "charge.dispute.created", {
      id: "dp_test_001",
      payment_intent: "pi_test_001",
      reason: "fraudulent",
      amount: 5000,
      status: "needs_response",
    });
  }

  it("creates a Dispute row with source CHARGEBACK", async () => {
    await makeService().processEvent(makeDisputeCreatedEvent());

    expect(mockCreateDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "ord-001",
        source: "CHARGEBACK",
        status: "OPEN",
      }),
      expect.anything(), // tx
    );
  });

  it("transitions order to DISPUTED", async () => {
    mockFindByStripePaymentIntentId.mockResolvedValue({
      ...BASE_ORDER,
      status: "PAYMENT_HELD",
    });

    await makeService().processEvent(makeDisputeCreatedEvent());

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "ord-001",
      "DISPUTED",
      expect.anything(),
      expect.objectContaining({ fromStatus: "PAYMENT_HELD" }),
    );
  });

  it("does not create duplicate dispute if one already exists", async () => {
    mockFindDisputeByOrderId.mockResolvedValue(BASE_DISPUTE);

    await makeService().processEvent(makeDisputeCreatedEvent());

    expect(mockCreateDispute).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5-6. charge.dispute.closed
// ═══════════════════════════════════════════════════════════════════════════════

describe("charge.dispute.closed handler", () => {
  function makeDisputeClosedEvent(status: "won" | "lost") {
    return makeEvent("evt_dispute_closed_001", "charge.dispute.closed", {
      id: "dp_test_001",
      payment_intent: "pi_test_001",
      reason: "fraudulent",
      amount: 5000,
      status,
    });
  }

  it("transitions order to COMPLETED when dispute is won", async () => {
    mockFindByStripePaymentIntentId.mockResolvedValue({
      ...BASE_ORDER,
      status: "DISPUTED",
    });

    await makeService().processEvent(makeDisputeClosedEvent("won"));

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "ord-001",
      "COMPLETED",
      expect.anything(),
      expect.objectContaining({ fromStatus: "DISPUTED" }),
    );
  });

  it("transitions order to REFUNDED when dispute is lost", async () => {
    mockFindByStripePaymentIntentId.mockResolvedValue({
      ...BASE_ORDER,
      status: "DISPUTED",
    });

    await makeService().processEvent(makeDisputeClosedEvent("lost"));

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "ord-001",
      "REFUNDED",
      expect.anything(),
      expect.objectContaining({ fromStatus: "DISPUTED" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7-8. payout.failed
// ═══════════════════════════════════════════════════════════════════════════════

describe("payout.failed handler", () => {
  function makePayoutFailedEvent(account = "acct_seller_001") {
    return makeEvent(
      "evt_payout_failed_001",
      "payout.failed",
      {
        id: "po_test_001",
        amount: 9430,
        currency: "nzd",
        failure_code: "insufficient_funds",
        failure_message: "The bank account has insufficient funds.",
        status: "failed",
      },
      account,
    );
  }

  it("marks the seller's latest PROCESSING payout as FAILED", async () => {
    await makeService().processEvent(makePayoutFailedEvent());

    expect(mockMarkFailed).toHaveBeenCalledWith(
      "payout-001",
      expect.any(String),
    );
  });

  it("logs error with requiresManualReconciliation: true", async () => {
    await makeService().processEvent(makePayoutFailedEvent());

    expect(mockLoggerError).toHaveBeenCalledWith(
      "webhook.payout.failed",
      expect.objectContaining({ requiresManualReconciliation: true }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. transfer.failed
// ═══════════════════════════════════════════════════════════════════════════════

describe("transfer.failed handler", () => {
  function makeTransferFailedEvent() {
    return makeEvent("evt_transfer_failed_001", "transfer.failed", {
      id: "tr_test_001",
      amount: 9430,
      currency: "nzd",
      destination: "acct_seller_001",
      metadata: { orderId: "ord-001", payoutId: "payout-001" },
    });
  }

  it("marks the payout as FAILED when transfer fails", async () => {
    await makeService().processEvent(makeTransferFailedEvent());

    expect(mockFindByStripeTransferId).toHaveBeenCalledWith("tr_test_001");
    expect(mockMarkFailed).toHaveBeenCalledWith(
      "payout-001",
      expect.any(String),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10-11. payment_intent.canceled
// ═══════════════════════════════════════════════════════════════════════════════

describe("payment_intent.canceled handler", () => {
  function makeCanceledEvent(listingId?: string) {
    return makeEvent("evt_pi_canceled_001", "payment_intent.canceled", {
      id: "pi_test_001",
      status: "canceled",
      cancellation_reason: "abandoned",
      metadata: {
        orderId: "ord-001",
        ...(listingId ? { listingId } : {}),
      },
    });
  }

  it("transitions order to CANCELLED when status is AWAITING_PAYMENT", async () => {
    mockFindForWebhookStatus.mockResolvedValue({
      status: "AWAITING_PAYMENT",
      fulfillmentType: "SHIPPED",
    });

    await makeService().processEvent(makeCanceledEvent());

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "ord-001",
      "CANCELLED",
      expect.anything(),
      expect.objectContaining({ fromStatus: "AWAITING_PAYMENT" }),
    );
  });

  it("releases the listing reservation when listingId is in metadata", async () => {
    mockFindForWebhookStatus.mockResolvedValue({
      status: "AWAITING_PAYMENT",
      fulfillmentType: "SHIPPED",
    });

    await makeService().processEvent(makeCanceledEvent("lst-001"));

    expect(mockReleaseReservation).toHaveBeenCalledWith("lst-001");
  });

  it("is idempotent — no transition if order already CANCELLED", async () => {
    mockFindForWebhookStatus.mockResolvedValue({
      status: "CANCELLED",
      fulfillmentType: "SHIPPED",
    });

    await makeService().processEvent(makeCanceledEvent());

    expect(mockTransitionOrder).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Unknown event type → warning logged
// ═══════════════════════════════════════════════════════════════════════════════

describe("unhandled event type", () => {
  it("logs warn (not error) for unknown event types", async () => {
    const event = makeEvent("evt_unknown_001", "invoice.created", {
      id: "in_test_001",
    });

    await makeService().processEvent(event);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "webhook.unhandled_event_type",
      expect.objectContaining({ eventType: "invoice.created" }),
    );
    expect(mockLoggerError).not.toHaveBeenCalledWith(
      "webhook.unhandled_event_type",
      expect.anything(),
    );
  });
});
