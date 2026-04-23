// src/test/shipping-delay-workflow.test.ts
// ─── Tests: shipping-delay-workflow.service ───────────────────────────────────
// Covers notifyShippingDelay() and respondToShippingDelay() branches:
// authorisation (seller-only), status gates (pre-dispatch only), interaction
// creation, acknowledge (ACCEPT) vs reject (REJECT) paths, and notifications.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Local mocks ──────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));

vi.mock("@/modules/orders/order-interaction.service", () => ({
  orderInteractionService: {
    respondToInteraction: vi.fn(),
    createInteraction: vi.fn(),
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
    SHIPPING_DELAY_NOTIFIED: "SHIPPING_DELAY_NOTIFIED",
  },
  ACTOR_ROLES: {
    BUYER: "BUYER",
    SELLER: "SELLER",
    SYSTEM: "SYSTEM",
  },
}));

vi.mock("@/modules/orders/interaction.repository", () => ({
  interactionRepository: {
    findOrderForWorkflow: vi.fn(),
    findOrderParties: vi.fn(),
    updateInteractionResolution: vi.fn().mockResolvedValue({}),
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
  notifyShippingDelay,
  respondToShippingDelay,
} from "@/modules/orders/workflows/shipping-delay-workflow.service";
import { orderInteractionService } from "@/modules/orders/order-interaction.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
} from "@/modules/orders/order-event.service";
import { interactionRepository } from "@/modules/orders/interaction.repository";
import { createNotification } from "@/modules/notifications/notification.service";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BUYER_ID = "buyer-s-1";
const SELLER_ID = "seller-s-1";
const OUTSIDER_ID = "outsider-s-1";
const ORDER_ID = "order-s-1";
const INTERACTION_ID = "interaction-s-1";

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    status: "PAYMENT_HELD",
    createdAt: new Date(),
    stripePaymentIntentId: "pi_test_321",
    totalNzd: 8000,
    listing: { title: "Handmade Ceramic Vase" },
    ...overrides,
  };
}

function makeDelayInteraction(overrides: Record<string, unknown> = {}) {
  return {
    id: INTERACTION_ID,
    orderId: ORDER_ID,
    type: "SHIPPING_DELAY",
    status: "PENDING",
    initiatedById: SELLER_ID,
    initiatorRole: "SELLER",
    reason: "Courier pickup delayed by 2 days",
    details: null,
    responseNote: null,
    responseById: null,
    respondedAt: null,
    resolvedAt: null,
    resolution: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    autoAction: "AUTO_APPROVE",
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── notifyShippingDelay ─────────────────────────────────────────────────────

describe("notifyShippingDelay — authorisation and status gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error when the order does not exist", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      null,
    );

    const result = await notifyShippingDelay(
      SELLER_ID,
      ORDER_ID,
      "Delayed due to weather",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Order not found.");
    expect(orderInteractionService.createInteraction).not.toHaveBeenCalled();
  });

  it("rejects a non-seller caller", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );

    const result = await notifyShippingDelay(
      BUYER_ID,
      ORDER_ID,
      "I am not the seller",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Only the seller");
  });

  it("rejects a random outsider caller", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );

    const result = await notifyShippingDelay(OUTSIDER_ID, ORDER_ID, "Whatever");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Only the seller");
  });

  it("rejects when the order is DISPATCHED (post-dispatch)", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "DISPATCHED" }) as never,
    );

    const result = await notifyShippingDelay(
      SELLER_ID,
      ORDER_ID,
      "Reason should not matter now",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("before dispatch");
  });

  it("rejects when the order is DELIVERED", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "DELIVERED" }) as never,
    );

    const result = await notifyShippingDelay(
      SELLER_ID,
      ORDER_ID,
      "Delivered already",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("before dispatch");
  });
});

describe("notifyShippingDelay — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "PAYMENT_HELD" }) as never,
    );
    vi.mocked(orderInteractionService.createInteraction).mockResolvedValue(
      makeDelayInteraction() as never,
    );
  });

  it("creates a SHIPPING_DELAY interaction with the supplied reason", async () => {
    const result = await notifyShippingDelay(
      SELLER_ID,
      ORDER_ID,
      "Courier pickup delayed",
    );

    expect(orderInteractionService.createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        type: "SHIPPING_DELAY",
        initiatedById: SELLER_ID,
        initiatorRole: "SELLER",
        reason: "Courier pickup delayed",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.interactionId).toBe(INTERACTION_ID);
  });

  it("includes estimatedNewDate in interaction details when provided", async () => {
    await notifyShippingDelay(
      SELLER_ID,
      ORDER_ID,
      "Stock arrives next Monday",
      "2025-07-01",
    );

    expect(orderInteractionService.createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          delayReason: "Stock arrives next Monday",
          newEstimatedDate: "2025-07-01",
        }),
      }),
    );
  });

  it("records a SHIPPING_DELAY_NOTIFIED order event", async () => {
    await notifyShippingDelay(SELLER_ID, ORDER_ID, "Courier pickup delayed");

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.SHIPPING_DELAY_NOTIFIED,
        orderId: ORDER_ID,
      }),
    );
  });

  it("notifies the buyer of the shipping delay", async () => {
    await notifyShippingDelay(SELLER_ID, ORDER_ID, "Courier pickup delayed");

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BUYER_ID,
        title: "Shipping delay",
        orderId: ORDER_ID,
      }),
    );
  });
});

// ─── respondToShippingDelay ──────────────────────────────────────────────────

describe("respondToShippingDelay — ACCEPT (acknowledge) path", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: makeDelayInteraction() as never,
      action: "ACCEPT",
    });
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );
  });

  it("dismisses the interaction when the buyer acknowledges", async () => {
    const result = await respondToShippingDelay(
      BUYER_ID,
      INTERACTION_ID,
      "ACCEPT",
    );

    expect(
      interactionRepository.updateInteractionResolution,
    ).toHaveBeenCalledWith(
      INTERACTION_ID,
      "DISMISSED",
      expect.anything(), // tx
    );
    expect(result.ok).toBe(true);
  });

  it("records a SHIPPING_DELAY_NOTIFIED event for the acknowledgement", async () => {
    await respondToShippingDelay(BUYER_ID, INTERACTION_ID, "ACCEPT");

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.SHIPPING_DELAY_NOTIFIED,
        orderId: ORDER_ID,
      }),
    );
  });

  it("notifies the seller that the buyer acknowledged the delay", async () => {
    await respondToShippingDelay(BUYER_ID, INTERACTION_ID, "ACCEPT");

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SELLER_ID, // interaction.initiatedById
        title: "Delay acknowledged",
      }),
    );
  });
});

describe("respondToShippingDelay — REJECT (dispute) path", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: makeDelayInteraction() as never,
      action: "REJECT",
    });
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );
  });

  it("does NOT update resolution on REJECT (no DISMISSED write)", async () => {
    await respondToShippingDelay(
      BUYER_ID,
      INTERACTION_ID,
      "REJECT",
      "Too long a delay for a gift",
    );

    expect(
      interactionRepository.updateInteractionResolution,
    ).not.toHaveBeenCalled();
  });

  it("records a SHIPPING_DELAY_NOTIFIED event describing the rejection", async () => {
    await respondToShippingDelay(
      BUYER_ID,
      INTERACTION_ID,
      "REJECT",
      "Too long a delay",
    );

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.SHIPPING_DELAY_NOTIFIED,
        metadata: expect.objectContaining({ action: "REJECT" }),
      }),
    );
  });

  it("notifies the seller with a cancellation-warning message", async () => {
    await respondToShippingDelay(
      BUYER_ID,
      INTERACTION_ID,
      "REJECT",
      "Too long a delay",
    );

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SELLER_ID,
        title: "Buyer did not accept delay",
      }),
    );
  });
});
