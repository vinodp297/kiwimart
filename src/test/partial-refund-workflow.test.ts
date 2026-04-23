// src/test/partial-refund-workflow.test.ts
// ─── Tests: partial-refund-workflow.service ───────────────────────────────────
// Covers requestPartialRefund() and respondToPartialRefund() branches:
// authorisation, status gates, amount validation, ACCEPT / REJECT / COUNTER
// response paths, event recording, counter-offer persistence, notifications.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Local mocks ──────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));

vi.mock("@/modules/orders/order-interaction.service", () => ({
  orderInteractionService: {
    respondToInteraction: vi.fn(),
    createInteraction: vi.fn(),
  },
  INTERACTION_TYPES: {
    PARTIAL_REFUND_REQUEST: "PARTIAL_REFUND_REQUEST",
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
    PARTIAL_REFUND_REQUESTED: "PARTIAL_REFUND_REQUESTED",
    PARTIAL_REFUND_APPROVED: "PARTIAL_REFUND_APPROVED",
  },
  ACTOR_ROLES: {
    BUYER: "BUYER",
    SELLER: "SELLER",
  },
}));

vi.mock("@/modules/orders/interaction.repository", () => ({
  interactionRepository: {
    findOrderForWorkflow: vi.fn(),
    updateInteractionResolution: vi.fn().mockResolvedValue({}),
    updateInteractionCounter: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  requestPartialRefund,
  respondToPartialRefund,
} from "@/modules/orders/workflows/partial-refund-workflow.service";
import { orderInteractionService } from "@/modules/orders/order-interaction.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
} from "@/modules/orders/order-event.service";
import { interactionRepository } from "@/modules/orders/interaction.repository";
import { createNotification } from "@/modules/notifications/notification.service";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BUYER_ID = "buyer-p-1";
const SELLER_ID = "seller-p-1";
const OUTSIDER_ID = "outsider-p-1";
const ORDER_ID = "order-p-1";
const INTERACTION_ID = "interaction-p-1";

// Order total: $50 (5000 cents)
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    status: "DELIVERED",
    createdAt: new Date(),
    stripePaymentIntentId: "pi_p_1",
    totalNzd: 5000,
    listing: { title: "Leather Bag" },
    ...overrides,
  };
}

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    id: INTERACTION_ID,
    orderId: ORDER_ID,
    type: "PARTIAL_REFUND_REQUEST",
    status: "PENDING",
    initiatedById: BUYER_ID,
    initiatorRole: "BUYER",
    reason: "Small scuff on leather",
    details: { requestedAmount: 1500, currency: "NZD" },
    responseNote: null,
    responseById: null,
    respondedAt: null,
    resolvedAt: null,
    resolution: null,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    autoAction: "AUTO_ESCALATE",
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── requestPartialRefund ────────────────────────────────────────────────────

describe("requestPartialRefund — authorisation and validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error when the order does not exist", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      null,
    );

    const result = await requestPartialRefund(
      BUYER_ID,
      ORDER_ID,
      "Minor damage",
      15,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Order not found.");
  });

  it("rejects a user who is neither buyer nor seller", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );

    const result = await requestPartialRefund(
      OUTSIDER_ID,
      ORDER_ID,
      "Ignored",
      10,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not a party");
  });

  it("rejects when order is not DELIVERED or COMPLETED", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "PAYMENT_HELD" }) as never,
    );

    const result = await requestPartialRefund(
      BUYER_ID,
      ORDER_ID,
      "Too early",
      10,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("completed or delivered");
  });

  it("rejects when the requested amount exceeds the order total", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ totalNzd: 5000 }) as never, // $50 order
    );

    // $60 > $50 → error
    const result = await requestPartialRefund(
      BUYER_ID,
      ORDER_ID,
      "Too greedy",
      60,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cannot exceed");
    expect(orderInteractionService.createInteraction).not.toHaveBeenCalled();
  });
});

describe("requestPartialRefund — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "DELIVERED" }) as never,
    );
    vi.mocked(orderInteractionService.createInteraction).mockResolvedValue(
      makeInteraction() as never,
    );
  });

  it("creates a PARTIAL_REFUND_REQUEST interaction with requestedAmount in cents", async () => {
    await requestPartialRefund(BUYER_ID, ORDER_ID, "Small scuff", 15);

    expect(orderInteractionService.createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        type: "PARTIAL_REFUND_REQUEST",
        initiatedById: BUYER_ID,
        initiatorRole: "BUYER",
        reason: "Small scuff",
        details: { requestedAmount: 1500, currency: "NZD" },
      }),
    );
  });

  it("records a PARTIAL_REFUND_REQUESTED event", async () => {
    await requestPartialRefund(BUYER_ID, ORDER_ID, "Small scuff", 15);

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_REQUESTED,
        orderId: ORDER_ID,
      }),
    );
  });

  it("notifies the seller when the buyer requests a partial refund", async () => {
    await requestPartialRefund(BUYER_ID, ORDER_ID, "Small scuff", 15);

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SELLER_ID,
        title: "Partial refund requested",
      }),
    );
  });

  it("notifies the buyer when the seller offers a partial refund proactively", async () => {
    await requestPartialRefund(SELLER_ID, ORDER_ID, "I noticed a defect", 10);

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: BUYER_ID }),
    );
  });

  it("allows a COMPLETED order to receive a partial-refund request", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "COMPLETED" }) as never,
    );

    const result = await requestPartialRefund(BUYER_ID, ORDER_ID, "Scuff", 10);

    expect(result.ok).toBe(true);
  });
});

// ─── respondToPartialRefund ──────────────────────────────────────────────────

describe("respondToPartialRefund — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects REJECT without a response note of at least 10 characters", async () => {
    const result = await respondToPartialRefund(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "nope",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("at least 10");
    expect(orderInteractionService.respondToInteraction).not.toHaveBeenCalled();
  });

  it("rejects COUNTER without a counterAmount", async () => {
    const result = await respondToPartialRefund(
      SELLER_ID,
      INTERACTION_ID,
      "COUNTER",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("counter-offer amount");
  });
});

describe("respondToPartialRefund — ACCEPT path", () => {
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

  it("marks the interaction resolution as PARTIAL_REFUND", async () => {
    await respondToPartialRefund(SELLER_ID, INTERACTION_ID, "ACCEPT");

    expect(
      interactionRepository.updateInteractionResolution,
    ).toHaveBeenCalledWith(
      INTERACTION_ID,
      "PARTIAL_REFUND",
      expect.anything(), // tx
    );
  });

  it("emits PARTIAL_REFUND_APPROVED event", async () => {
    await respondToPartialRefund(SELLER_ID, INTERACTION_ID, "ACCEPT");

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_APPROVED,
        orderId: ORDER_ID,
      }),
    );
  });

  it("notifies the initiator of the approval", async () => {
    await respondToPartialRefund(SELLER_ID, INTERACTION_ID, "ACCEPT");

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BUYER_ID, // interaction.initiatedById
        title: "Partial refund approved",
      }),
    );
  });
});

describe("respondToPartialRefund — REJECT path", () => {
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

  it("emits PARTIAL_REFUND_REQUESTED event with the rejection summary", async () => {
    await respondToPartialRefund(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "Items were described accurately",
    );

    // REJECT reuses PARTIAL_REFUND_REQUESTED to preserve a rejection trail
    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_REQUESTED,
      }),
    );
    // No resolution update on REJECT
    expect(
      interactionRepository.updateInteractionResolution,
    ).not.toHaveBeenCalled();
  });

  it("notifies the initiator of the rejection", async () => {
    await respondToPartialRefund(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "Items were described accurately",
    );

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BUYER_ID,
        title: "Partial refund rejected",
      }),
    );
  });
});

describe("respondToPartialRefund — COUNTER path", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderInteractionService.respondToInteraction).mockResolvedValue({
      interaction: makeInteraction() as never,
      action: "REJECT", // COUNTER maps to REJECT on the underlying service
    });
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );
  });

  it("persists the counter-offer amount via updateInteractionCounter", async () => {
    // Counter of $10 = 1000 cents
    await respondToPartialRefund(
      SELLER_ID,
      INTERACTION_ID,
      "COUNTER",
      undefined,
      10,
    );

    expect(interactionRepository.updateInteractionCounter).toHaveBeenCalledWith(
      INTERACTION_ID,
      expect.objectContaining({
        counterAmount: 1000,
        counterCurrency: "NZD",
      }),
    );
  });

  it("sends a counter-offer notification to the initiator", async () => {
    await respondToPartialRefund(
      SELLER_ID,
      INTERACTION_ID,
      "COUNTER",
      undefined,
      10,
    );

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BUYER_ID,
        title: "Counter-offer received",
      }),
    );
  });

  it("records a PARTIAL_REFUND_REQUESTED event for the counter-offer", async () => {
    await respondToPartialRefund(
      SELLER_ID,
      INTERACTION_ID,
      "COUNTER",
      undefined,
      10,
    );

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_REQUESTED,
        metadata: expect.objectContaining({ counterAmount: 1000 }),
      }),
    );
  });
});
