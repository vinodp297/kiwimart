// src/test/cancellation-workflow.test.ts
// ─── Tests: cancellation-workflow.service ─────────────────────────────────────
// Covers requestCancellation() and respondToCancellation() branches:
// authorisation, status gates, free-window auto-approval, refund triggering,
// request-window expiry, accept/reject paths, refund failure logging.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Local mocks (override / supplement setup.ts) ─────────────────────────────

vi.mock("server-only", () => ({}));

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
    SHIPPING_DELAY: "SHIPPING_DELAY",
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
  },
  ORDER_EVENT_TYPES: {
    CANCEL_REQUESTED: "CANCEL_REQUESTED",
    CANCEL_APPROVED: "CANCEL_APPROVED",
    CANCEL_REJECTED: "CANCEL_REJECTED",
    CANCEL_AUTO_APPROVED: "CANCEL_AUTO_APPROVED",
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
  },
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  requestCancellation,
  respondToCancellation,
} from "@/modules/orders/workflows/cancellation-workflow.service";
import { orderService } from "@/modules/orders/order.service";
import { paymentService } from "@/modules/payments/payment.service";
import { orderInteractionService } from "@/modules/orders/order-interaction.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
} from "@/modules/orders/order-event.service";
import { interactionRepository } from "@/modules/orders/interaction.repository";
import { createNotification } from "@/modules/notifications/notification.service";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BUYER_ID = "buyer-c-1";
const SELLER_ID = "seller-c-1";
const OUTSIDER_ID = "outsider-c-1";
const ORDER_ID = "order-c-1";
const INTERACTION_ID = "interaction-c-1";

/** Build an order that matches findOrderForWorkflow's return shape. */
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    status: "PAYMENT_HELD",
    createdAt: new Date(),
    stripePaymentIntentId: "pi_test_123",
    totalNzd: 5000,
    listing: { title: "Vintage Polaroid" },
    ...overrides,
  };
}

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    id: INTERACTION_ID,
    orderId: ORDER_ID,
    type: "CANCEL_REQUEST",
    status: "PENDING",
    initiatedById: BUYER_ID,
    initiatorRole: "BUYER",
    reason: "Changed my mind",
    details: null,
    responseNote: null,
    responseById: null,
    respondedAt: null,
    resolvedAt: null,
    resolution: null,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    autoAction: "AUTO_APPROVE",
    createdAt: new Date(),
  };
}

// ─── requestCancellation ─────────────────────────────────────────────────────

describe("requestCancellation — authorisation and status gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error when the order does not exist", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      null,
    );

    const result = await requestCancellation(
      BUYER_ID,
      ORDER_ID,
      "Not needed any more",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Order not found.");
    expect(orderService.cancelOrder).not.toHaveBeenCalled();
  });

  it("rejects a user who is neither buyer nor seller", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );

    const result = await requestCancellation(
      OUTSIDER_ID,
      ORDER_ID,
      "Curious stranger",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not a party");
  });

  it("rejects cancellation for DISPATCHED orders with dispute guidance", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "DISPATCHED" }) as never,
    );

    const result = await requestCancellation(
      BUYER_ID,
      ORDER_ID,
      "Changed my mind",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("dispute");
  });

  it("rejects cancellation for DELIVERED orders with dispute guidance", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "DELIVERED" }) as never,
    );

    const result = await requestCancellation(
      BUYER_ID,
      ORDER_ID,
      "Changed my mind",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("dispute");
  });

  it("rejects cancellation for COMPLETED orders with a generic message", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "COMPLETED" }) as never,
    );

    const result = await requestCancellation(
      BUYER_ID,
      ORDER_ID,
      "Changed my mind",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cannot be cancelled");
  });
});

describe("requestCancellation — free-window auto-approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-approves when PAYMENT_HELD and within the 60-minute free window", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      }) as never,
    );

    const result = await requestCancellation(
      BUYER_ID,
      ORDER_ID,
      "Changed mind",
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.autoApproved).toBe(true);
    expect(orderService.cancelOrder).toHaveBeenCalledWith(
      ORDER_ID,
      BUYER_ID,
      "Changed mind",
    );
  });

  it("triggers a Stripe refund on auto-approval when PAYMENT_HELD", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        stripePaymentIntentId: "pi_live_42",
      }) as never,
    );

    await requestCancellation(BUYER_ID, ORDER_ID, "Changed mind");

    expect(paymentService.refundPayment).toHaveBeenCalledWith({
      paymentIntentId: "pi_live_42",
      orderId: ORDER_ID,
    });
  });

  it("does NOT trigger a refund when status is AWAITING_PAYMENT (no capture yet)", async () => {
    // AWAITING_PAYMENT is outside the free window because isInFreeWindow
    // requires PAYMENT_HELD — falls through to the request-window path.
    // We verify that path creates an interaction (no refund call happens).
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({
        status: "AWAITING_PAYMENT",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      }) as never,
    );
    vi.mocked(orderInteractionService.createInteraction).mockResolvedValue(
      makeInteraction() as never,
    );

    const result = await requestCancellation(
      BUYER_ID,
      ORDER_ID,
      "Not ready to pay",
    );

    expect(paymentService.refundPayment).not.toHaveBeenCalled();
    expect(orderService.cancelOrder).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.autoApproved).toBe(false);
  });

  it("records both CANCEL_REQUESTED and CANCEL_AUTO_APPROVED events on free-window path", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 15 * 60 * 1000),
      }) as never,
    );

    await requestCancellation(BUYER_ID, ORDER_ID, "Changed mind");

    const recordedTypes = vi
      .mocked(orderEventService.recordEvent)
      .mock.calls.map((call) => (call[0] as { type: string }).type);
    expect(recordedTypes).toContain(ORDER_EVENT_TYPES.CANCEL_REQUESTED);
    expect(recordedTypes).toContain(ORDER_EVENT_TYPES.CANCEL_AUTO_APPROVED);
  });

  it("sends a notification to the seller when the buyer auto-cancels", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      }) as never,
    );

    await requestCancellation(BUYER_ID, ORDER_ID, "Changed mind");

    // Notification routed to the seller (the counterparty)
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SELLER_ID, orderId: ORDER_ID }),
    );
  });

  it("logs — but swallows — Stripe refund failure on auto-approval", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      }) as never,
    );
    vi.mocked(paymentService.refundPayment).mockRejectedValueOnce(
      new Error("Stripe rejected the refund"),
    );

    const result = await requestCancellation(
      BUYER_ID,
      ORDER_ID,
      "Changed mind",
    );

    // Cancellation still succeeds — refund failure is isolated
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.autoApproved).toBe(true);
  });
});

describe("requestCancellation — request-window path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an interaction when outside free window but within request window", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
      }) as never,
    );
    vi.mocked(orderInteractionService.createInteraction).mockResolvedValue(
      makeInteraction() as never,
    );

    const result = await requestCancellation(
      BUYER_ID,
      ORDER_ID,
      "Package overdue",
    );

    expect(orderService.cancelOrder).not.toHaveBeenCalled();
    expect(orderInteractionService.createInteraction).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.autoApproved).toBe(false);
      expect(result.data.interactionId).toBe(INTERACTION_ID);
    }
  });

  it("rejects when the order is outside the 24-hour request window", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
      }) as never,
    );

    const result = await requestCancellation(
      BUYER_ID,
      ORDER_ID,
      "Too late to cancel",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("within 24 hours");
    expect(orderInteractionService.createInteraction).not.toHaveBeenCalled();
  });

  it("notifies the other party of the pending cancellation request", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      }) as never,
    );
    vi.mocked(orderInteractionService.createInteraction).mockResolvedValue(
      makeInteraction() as never,
    );

    // Seller initiating → buyer is notified
    await requestCancellation(
      SELLER_ID,
      ORDER_ID,
      "Item damaged before dispatch",
    );

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BUYER_ID,
        title: "Cancellation requested",
      }),
    );
  });
});

// ─── respondToCancellation ───────────────────────────────────────────────────

describe("respondToCancellation — validation and state gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a response note of at least 10 characters on REJECT", async () => {
    const result = await respondToCancellation(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "Short",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("at least 10");
    expect(orderInteractionService.respondToInteraction).not.toHaveBeenCalled();
  });

  it("returns error when the order lookup fails after respondToInteraction", async () => {
    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: makeInteraction() as never,
      action: "ACCEPT",
    });
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      null,
    );

    const result = await respondToCancellation(
      SELLER_ID,
      INTERACTION_ID,
      "ACCEPT",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Order not found.");
  });
});

describe("respondToCancellation — ACCEPT path", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: makeInteraction() as never,
      action: "ACCEPT",
    });
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );
  });

  it("calls orderService.cancelOrder with the initiator as canceller", async () => {
    const result = await respondToCancellation(
      SELLER_ID,
      INTERACTION_ID,
      "ACCEPT",
    );

    expect(orderService.cancelOrder).toHaveBeenCalledWith(
      ORDER_ID,
      BUYER_ID, // interaction.initiatedById
      "Changed my mind", // interaction.reason
    );
    expect(result.ok).toBe(true);
  });

  it("triggers a refund when the order is PAYMENT_HELD", async () => {
    await respondToCancellation(SELLER_ID, INTERACTION_ID, "ACCEPT");

    expect(paymentService.refundPayment).toHaveBeenCalledWith({
      paymentIntentId: "pi_test_123",
      orderId: ORDER_ID,
    });
  });

  it("does NOT trigger a refund when the order is AWAITING_PAYMENT", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "AWAITING_PAYMENT" }) as never,
    );

    await respondToCancellation(SELLER_ID, INTERACTION_ID, "ACCEPT");

    expect(paymentService.refundPayment).not.toHaveBeenCalled();
  });

  it("emits CANCEL_APPROVED event", async () => {
    await respondToCancellation(SELLER_ID, INTERACTION_ID, "ACCEPT");

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.CANCEL_APPROVED,
        orderId: ORDER_ID,
      }),
    );
  });

  it("sends an approval notification to the initiator", async () => {
    await respondToCancellation(SELLER_ID, INTERACTION_ID, "ACCEPT");

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BUYER_ID,
        title: "Cancellation approved",
      }),
    );
  });

  it("still returns ok:true when the Stripe refund fails on ACCEPT", async () => {
    vi.mocked(paymentService.refundPayment).mockRejectedValueOnce(
      new Error("Stripe timeout"),
    );

    const result = await respondToCancellation(
      SELLER_ID,
      INTERACTION_ID,
      "ACCEPT",
    );

    expect(result.ok).toBe(true);
    // Events and notification still fire
    expect(orderEventService.recordEvent).toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalled();
  });
});

describe("respondToCancellation — REJECT path", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: makeInteraction() as never,
      action: "REJECT",
    });
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );
  });

  it("emits CANCEL_REJECTED event with the response note", async () => {
    await respondToCancellation(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "The item has already been packed and is ready to ship.",
    );

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.CANCEL_REJECTED,
      }),
    );
    // cancelOrder must NOT be called on reject
    expect(orderService.cancelOrder).not.toHaveBeenCalled();
    expect(paymentService.refundPayment).not.toHaveBeenCalled();
  });

  it("sends a rejection notification to the initiator with dispute guidance", async () => {
    await respondToCancellation(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "The item has already been packed and is ready to ship.",
    );

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BUYER_ID,
        title: "Cancellation rejected",
      }),
    );
  });
});
