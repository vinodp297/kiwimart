// src/test/interaction-workflow-atomic.test.ts
// ─── Interaction Workflow — atomic transaction threading ──────────────────────
// Verifies that the three (write + event) pairs that were wrapped in
// orderRepository.$transaction now:
//   1. Call both the DB write and recordEvent inside the same transaction.
//   2. Pass the same tx object to both calls.
//   3. Propagate errors from recordEvent so the whole transaction fails
//      (which in production causes Postgres to roll back the DB write).
//
// Fire-and-forget paths are also tested to confirm tx is intentionally absent.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Local overrides for mocks not covered by setup.ts ────────────────────────
vi.mock("@/server/email", () => ({
  sendReturnRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendDataExportEmail: vi.fn().mockResolvedValue(undefined),
  sendErasureConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendAdminIdVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendDisputeOpenedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

vi.mock("@/modules/orders/order.service", () => ({
  orderService: {
    cancelOrder: vi.fn().mockResolvedValue(undefined),
    getOrderById: vi.fn(),
  },
}));

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    refundPayment: vi.fn().mockResolvedValue(undefined),
    createPaymentIntent: vi.fn(),
    capturePayment: vi.fn(),
  },
}));

vi.mock("@/modules/orders/order-interaction.service", () => ({
  orderInteractionService: {
    respondToInteraction: vi.fn(),
    createInteraction: vi.fn(),
    getActiveInteractions: vi.fn().mockResolvedValue([]),
    getInteractionsByOrder: vi.fn().mockResolvedValue([]),
  },
  INTERACTION_TYPES: {
    CANCEL_REQUEST: "CANCEL_REQUEST",
    RETURN_REQUEST: "RETURN_REQUEST",
    PARTIAL_REFUND_REQUEST: "PARTIAL_REFUND_REQUEST",
    DELIVERY_ISSUE: "DELIVERY_ISSUE",
    SHIPPING_DELAY: "SHIPPING_DELAY",
    OUT_OF_STOCK: "OUT_OF_STOCK",
    COUNTER_OFFER: "COUNTER_OFFER",
  },
  INTERACTION_STATUSES: {
    PENDING: "PENDING",
    ACCEPTED: "ACCEPTED",
    REJECTED: "REJECTED",
    COUNTERED: "COUNTERED",
    EXPIRED: "EXPIRED",
    ESCALATED: "ESCALATED",
    RESOLVED: "RESOLVED",
  },
  AUTO_ACTIONS: {
    AUTO_APPROVE: "AUTO_APPROVE",
    AUTO_REJECT: "AUTO_REJECT",
    AUTO_ESCALATE: "AUTO_ESCALATE",
  },
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: {
    recordEvent: vi.fn().mockResolvedValue(undefined),
    getOrderTimeline: vi.fn().mockResolvedValue([]),
  },
  ORDER_EVENT_TYPES: {
    ORDER_CREATED: "ORDER_CREATED",
    PAYMENT_HELD: "PAYMENT_HELD",
    PAYMENT_CAPTURED: "PAYMENT_CAPTURED",
    DISPATCHED: "DISPATCHED",
    DELIVERED: "DELIVERED",
    COMPLETED: "COMPLETED",
    CANCEL_REQUESTED: "CANCEL_REQUESTED",
    CANCEL_APPROVED: "CANCEL_APPROVED",
    CANCEL_REJECTED: "CANCEL_REJECTED",
    CANCEL_AUTO_APPROVED: "CANCEL_AUTO_APPROVED",
    DISPUTE_OPENED: "DISPUTE_OPENED",
    DISPUTE_RESPONDED: "DISPUTE_RESPONDED",
    DISPUTE_RESOLVED: "DISPUTE_RESOLVED",
    REFUNDED: "REFUNDED",
    CANCELLED: "CANCELLED",
    RETURN_REQUESTED: "RETURN_REQUESTED",
    RETURN_APPROVED: "RETURN_APPROVED",
    RETURN_REJECTED: "RETURN_REJECTED",
    PARTIAL_REFUND_REQUESTED: "PARTIAL_REFUND_REQUESTED",
    PARTIAL_REFUND_APPROVED: "PARTIAL_REFUND_APPROVED",
    SHIPPING_DELAY_NOTIFIED: "SHIPPING_DELAY_NOTIFIED",
    INTERACTION_EXPIRED: "INTERACTION_EXPIRED",
    REVIEW_SUBMITTED: "REVIEW_SUBMITTED",
    DELIVERY_ISSUE_REPORTED: "DELIVERY_ISSUE_REPORTED",
    DELIVERY_CONFIRMED_OK: "DELIVERY_CONFIRMED_OK",
    AUTO_RESOLVED: "AUTO_RESOLVED",
    FRAUD_FLAGGED: "FRAUD_FLAGGED",
    DELIVERY_REMINDER_SENT: "DELIVERY_REMINDER_SENT",
    AUTO_COMPLETED: "AUTO_COMPLETED",
  },
  ACTOR_ROLES: {
    BUYER: "BUYER",
    SELLER: "SELLER",
    ADMIN: "ADMIN",
    SYSTEM: "SYSTEM",
  },
}));

vi.mock("@/modules/orders/interaction.repository", () => ({
  interactionRepository: {
    findOrderForWorkflow: vi.fn(),
    findOrderParties: vi.fn(),
    updateInteractionResolution: vi.fn().mockResolvedValue({}),
    updateInteractionCounter: vi.fn().mockResolvedValue({}),
    findUserEmailInfo: vi
      .fn()
      .mockResolvedValue({ email: "x@x.com", displayName: "Test" }),
    findOrderForInteraction: vi.fn(),
    findPendingByTypeAndOrder: vi.fn().mockResolvedValue(null),
    createInteraction: vi.fn(),
    findByIdWithOrder: vi.fn(),
    updateInteraction: vi.fn().mockResolvedValue({}),
    findActiveByOrder: vi.fn().mockResolvedValue([]),
    countPriorBuyerInteractions: vi.fn().mockResolvedValue(0),
    findRejectedByResponder: vi.fn().mockResolvedValue(null),
    findAllByOrder: vi.fn().mockResolvedValue([]),
  },
}));

// ── Module under test ─────────────────────────────────────────────────────────
import db from "@/lib/db";
import { interactionWorkflowService } from "@/modules/orders/interaction-workflow.service";
import { interactionRepository } from "@/modules/orders/interaction.repository";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
} from "@/modules/orders/order-event.service";
import { orderInteractionService } from "@/modules/orders/order-interaction.service";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BUYER_ID = "buyer-workflow-1";
const SELLER_ID = "seller-workflow-1";
const ORDER_ID = "order-workflow-1";
const INTERACTION_ID = "interaction-workflow-1";

const MOCK_INTERACTION = {
  id: INTERACTION_ID,
  orderId: ORDER_ID,
  type: "RETURN_REQUEST",
  status: "PENDING",
  initiatedById: BUYER_ID,
  initiatorRole: "BUYER",
  reason: "Item not as described",
  details: null,
  responseNote: null,
  responseById: null,
  respondedAt: null,
  resolvedAt: null,
  resolution: null,
  expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
  autoAction: "AUTO_ESCALATE",
  createdAt: new Date(),
  order: {
    id: ORDER_ID,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    status: "COMPLETED",
  },
};

const MOCK_ORDER = {
  id: ORDER_ID,
  buyerId: BUYER_ID,
  sellerId: SELLER_ID,
  status: "COMPLETED",
  createdAt: new Date(),
  stripePaymentIntentId: "pi_test",
  totalNzd: 5000,
  listing: { title: "Vintage Camera" },
};

// ─────────────────────────────────────────────────────────────────────────────

describe("respondToReturn — atomic transaction (ACCEPT path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: MOCK_INTERACTION as never,
      action: "ACCEPT",
    });

    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      MOCK_ORDER as never,
    );

    vi.mocked(
      interactionRepository.updateInteractionResolution,
    ).mockResolvedValue({} as never);

    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockResolvedValue(undefined);
  });

  // ── Test 1: $transaction is entered ────────────────────────────────────────
  it("wraps updateInteractionResolution and recordEvent in one $transaction", async () => {
    await interactionWorkflowService.respondToReturn(
      SELLER_ID,
      INTERACTION_ID,
      "ACCEPT",
    );

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(
      interactionRepository.updateInteractionResolution,
    ).toHaveBeenCalledWith(
      INTERACTION_ID,
      "RETURNED",
      expect.anything(), // tx
    );
    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: ORDER_EVENT_TYPES.RETURN_APPROVED }),
    );
  });

  // ── Test 2: Same tx object is passed to both calls ─────────────────────────
  it("passes the same tx to both updateInteractionResolution and recordEvent", async () => {
    const capturedTxObjects: unknown[] = [];

    vi.mocked(
      interactionRepository.updateInteractionResolution,
    ).mockImplementation(async (_id, _resolution, tx) => {
      capturedTxObjects.push(tx);
      return {} as never;
    });

    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockImplementation(async (input: { tx?: unknown }) => {
      capturedTxObjects.push(input.tx);
    });

    await interactionWorkflowService.respondToReturn(
      SELLER_ID,
      INTERACTION_ID,
      "ACCEPT",
    );

    // Both calls must have received a tx
    expect(capturedTxObjects).toHaveLength(2);
    expect(capturedTxObjects[0]).toBeDefined();
    expect(capturedTxObjects[1]).toBeDefined();
    // Both must reference the same transaction client
    expect(capturedTxObjects[0]).toBe(capturedTxObjects[1]);
  });

  // ── Test 3: Error from recordEvent propagates (rolls back in production) ───
  it("propagates recordEvent error so the transaction fails atomically", async () => {
    const eventError = new Error("orderEvent.create simulated failure");
    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockRejectedValueOnce(eventError);

    await expect(
      interactionWorkflowService.respondToReturn(
        SELLER_ID,
        INTERACTION_ID,
        "ACCEPT",
      ),
    ).rejects.toThrow("orderEvent.create simulated failure");
  });

  // ── Test 4: REJECT path — fire-and-forget (no tx) ──────────────────────────
  it("does NOT pass tx on REJECT path (intentional fire-and-forget)", async () => {
    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: { ...MOCK_INTERACTION, type: "RETURN_REQUEST" } as never,
      action: "REJECT",
    });

    let recordedTx: unknown = "sentinel-not-called";
    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockImplementation(async (input: { tx?: unknown }) => {
      recordedTx = input.tx;
    });

    await interactionWorkflowService.respondToReturn(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "Item was clearly described in the listing.",
    );

    // recordEvent is called but WITHOUT tx (fire-and-forget, see comment in service)
    expect(orderEventService.recordEvent).toHaveBeenCalledOnce();
    expect(recordedTx).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("respondToPartialRefund — atomic transaction (ACCEPT path)", () => {
  const PARTIAL_REFUND_INTERACTION = {
    ...MOCK_INTERACTION,
    type: "PARTIAL_REFUND_REQUEST",
    details: { requestedAmount: 1500, currency: "NZD" },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: PARTIAL_REFUND_INTERACTION as never,
      action: "ACCEPT",
    });

    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      MOCK_ORDER as never,
    );

    vi.mocked(
      interactionRepository.updateInteractionResolution,
    ).mockResolvedValue({} as never);

    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockResolvedValue(undefined);
  });

  // ── Test 5: $transaction is entered on ACCEPT ───────────────────────────────
  it("wraps updateInteractionResolution and recordEvent in one $transaction on ACCEPT", async () => {
    await interactionWorkflowService.respondToPartialRefund(
      SELLER_ID,
      INTERACTION_ID,
      "ACCEPT",
    );

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(
      interactionRepository.updateInteractionResolution,
    ).toHaveBeenCalledWith(
      INTERACTION_ID,
      "PARTIAL_REFUND",
      expect.anything(), // tx
    );
    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_APPROVED,
      }),
    );
  });

  // ── Test 6: Same tx passed to both calls on ACCEPT ─────────────────────────
  it("passes the same tx to both calls on ACCEPT", async () => {
    const capturedTxObjects: unknown[] = [];

    vi.mocked(
      interactionRepository.updateInteractionResolution,
    ).mockImplementation(async (_id, _resolution, tx) => {
      capturedTxObjects.push(tx);
      return {} as never;
    });

    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockImplementation(async (input: { tx?: unknown }) => {
      capturedTxObjects.push(input.tx);
    });

    await interactionWorkflowService.respondToPartialRefund(
      SELLER_ID,
      INTERACTION_ID,
      "ACCEPT",
    );

    expect(capturedTxObjects).toHaveLength(2);
    expect(capturedTxObjects[0]).toBeDefined();
    expect(capturedTxObjects[0]).toBe(capturedTxObjects[1]);
  });

  // ── Test 7: recordEvent error propagates on ACCEPT ─────────────────────────
  it("propagates recordEvent error so the transaction fails", async () => {
    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockRejectedValueOnce(new Error("partial-refund event write failed"));

    await expect(
      interactionWorkflowService.respondToPartialRefund(
        SELLER_ID,
        INTERACTION_ID,
        "ACCEPT",
      ),
    ).rejects.toThrow("partial-refund event write failed");
  });

  // ── Test 8: REJECT path is fire-and-forget (no tx) ─────────────────────────
  it("does NOT pass tx on REJECT path (intentional fire-and-forget)", async () => {
    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: PARTIAL_REFUND_INTERACTION as never,
      action: "REJECT",
    });

    let recordedTx: unknown = "sentinel-not-called";
    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockImplementation(async (input: { tx?: unknown }) => {
      recordedTx = input.tx;
    });

    await interactionWorkflowService.respondToPartialRefund(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "Amount is unreasonable for this item.",
    );

    expect(orderEventService.recordEvent).toHaveBeenCalledOnce();
    expect(recordedTx).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("respondToShippingDelay — atomic transaction", () => {
  const DELAY_INTERACTION = {
    ...MOCK_INTERACTION,
    type: "SHIPPING_DELAY",
    initiatedById: SELLER_ID,
    initiatorRole: "SELLER",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: DELAY_INTERACTION as never,
      action: "ACCEPT",
    });

    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      MOCK_ORDER as never,
    );

    vi.mocked(
      interactionRepository.updateInteractionResolution,
    ).mockResolvedValue({} as never);

    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockResolvedValue(undefined);
  });

  // ── Test 9: $transaction entered for ACCEPT ────────────────────────────────
  it("wraps updateInteractionResolution and recordEvent in $transaction on ACCEPT", async () => {
    await interactionWorkflowService.respondToShippingDelay(
      BUYER_ID,
      INTERACTION_ID,
      "ACCEPT",
    );

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(
      interactionRepository.updateInteractionResolution,
    ).toHaveBeenCalledWith(
      INTERACTION_ID,
      "DISMISSED",
      expect.anything(), // tx
    );
    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.SHIPPING_DELAY_NOTIFIED,
      }),
    );
  });

  // ── Test 10: Same tx passed to both on ACCEPT ──────────────────────────────
  it("passes the same tx to both calls on ACCEPT", async () => {
    const capturedTxObjects: unknown[] = [];

    vi.mocked(
      interactionRepository.updateInteractionResolution,
    ).mockImplementation(async (_id, _resolution, tx) => {
      capturedTxObjects.push(tx);
      return {} as never;
    });

    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockImplementation(async (input: { tx?: unknown }) => {
      capturedTxObjects.push(input.tx);
    });

    await interactionWorkflowService.respondToShippingDelay(
      BUYER_ID,
      INTERACTION_ID,
      "ACCEPT",
    );

    // updateInteractionResolution + recordEvent both received tx
    expect(capturedTxObjects).toHaveLength(2);
    expect(capturedTxObjects[0]).toBeDefined();
    expect(capturedTxObjects[0]).toBe(capturedTxObjects[1]);
  });

  // ── Test 11: REJECT path — $transaction entered, but no resolution update ──
  it("wraps recordEvent in $transaction on REJECT (no resolution update)", async () => {
    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: DELAY_INTERACTION as never,
      action: "REJECT",
    });

    let recordedTx: unknown = undefined;
    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockImplementation(async (input: { tx?: unknown }) => {
      recordedTx = input.tx;
    });

    await interactionWorkflowService.respondToShippingDelay(
      BUYER_ID,
      INTERACTION_ID,
      "REJECT",
    );

    expect(db.$transaction).toHaveBeenCalledOnce();
    // On REJECT, no resolution update is written
    expect(
      interactionRepository.updateInteractionResolution,
    ).not.toHaveBeenCalled();
    // But recordEvent is still inside the transaction
    expect(recordedTx).toBeDefined();
  });

  // ── Test 12: recordEvent error propagates ─────────────────────────────────
  it("propagates recordEvent error so the transaction fails", async () => {
    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockRejectedValueOnce(new Error("shipping-delay event write failed"));

    await expect(
      interactionWorkflowService.respondToShippingDelay(
        BUYER_ID,
        INTERACTION_ID,
        "ACCEPT",
      ),
    ).rejects.toThrow("shipping-delay event write failed");
  });
});
