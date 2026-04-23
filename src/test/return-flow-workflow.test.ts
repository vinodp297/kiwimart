// src/test/return-flow-workflow.test.ts
// ─── Tests: return-flow.service ───────────────────────────────────────────────
// Covers requestReturn() and respondToReturn() branches: authorisation,
// status gates, ACCEPT / REJECT paths, event recording, email dispatch,
// resolution update, and notifications.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Local mocks ──────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));

// Override the broad server/email mock from setup.ts to capture return emails.
vi.mock("@/server/email", () => ({
  sendReturnRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendDataExportEmail: vi.fn().mockResolvedValue(undefined),
  sendErasureConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendErasureRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendAdminIdVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendDisputeOpenedEmail: vi.fn().mockResolvedValue(undefined),
  sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order-interaction.service", () => ({
  orderInteractionService: {
    respondToInteraction: vi.fn(),
    createInteraction: vi.fn(),
  },
  INTERACTION_TYPES: {
    RETURN_REQUEST: "RETURN_REQUEST",
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
    RETURN_REQUESTED: "RETURN_REQUESTED",
    RETURN_APPROVED: "RETURN_APPROVED",
    RETURN_REJECTED: "RETURN_REJECTED",
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
    findUserEmailInfo: vi
      .fn()
      .mockResolvedValue({ email: "seller@test.com", displayName: "Seller" }),
  },
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  requestReturn,
  respondToReturn,
} from "@/modules/orders/workflows/return-flow.service";
import { orderInteractionService } from "@/modules/orders/order-interaction.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
} from "@/modules/orders/order-event.service";
import { interactionRepository } from "@/modules/orders/interaction.repository";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendReturnRequestEmail } from "@/server/email";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BUYER_ID = "buyer-r-1";
const SELLER_ID = "seller-r-1";
const OUTSIDER_ID = "outsider-r-1";
const ORDER_ID = "order-r-1";
const INTERACTION_ID = "interaction-r-1";

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    status: "DELIVERED",
    createdAt: new Date(),
    stripePaymentIntentId: "pi_r_1",
    totalNzd: 6000,
    listing: { title: "Board Game" },
    ...overrides,
  };
}

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    id: INTERACTION_ID,
    orderId: ORDER_ID,
    type: "RETURN_REQUEST",
    status: "PENDING",
    initiatedById: BUYER_ID,
    initiatorRole: "BUYER",
    reason: "Missing pieces",
    details: null,
    responseNote: null,
    responseById: null,
    respondedAt: null,
    resolvedAt: null,
    resolution: null,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    autoAction: "AUTO_ESCALATE",
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── requestReturn ───────────────────────────────────────────────────────────

describe("requestReturn — authorisation and status gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error when the order does not exist", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      null,
    );

    const result = await requestReturn(BUYER_ID, ORDER_ID, "Missing pieces");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Order not found.");
  });

  it("rejects a non-buyer caller (seller attempting return)", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );

    const result = await requestReturn(
      SELLER_ID,
      ORDER_ID,
      "Seller cannot return",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Only the buyer");
  });

  it("rejects a random outsider caller", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder() as never,
    );

    const result = await requestReturn(OUTSIDER_ID, ORDER_ID, "Random user");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Only the buyer");
  });

  it("rejects when order status is not DELIVERED or COMPLETED", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "PAYMENT_HELD" }) as never,
    );

    const result = await requestReturn(BUYER_ID, ORDER_ID, "Too early");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("completed or delivered");
    expect(orderInteractionService.createInteraction).not.toHaveBeenCalled();
  });

  it("allows requestReturn for a COMPLETED order", async () => {
    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "COMPLETED" }) as never,
    );
    vi.mocked(orderInteractionService.createInteraction).mockResolvedValue(
      makeInteraction() as never,
    );

    const result = await requestReturn(BUYER_ID, ORDER_ID, "Missing pieces");

    expect(result.ok).toBe(true);
  });
});

describe("requestReturn — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(interactionRepository.findOrderForWorkflow).mockResolvedValue(
      makeOrder({ status: "DELIVERED" }) as never,
    );
    vi.mocked(orderInteractionService.createInteraction).mockResolvedValue(
      makeInteraction() as never,
    );
  });

  it("creates a RETURN_REQUEST interaction attributed to the buyer", async () => {
    await requestReturn(BUYER_ID, ORDER_ID, "Missing pieces");

    expect(orderInteractionService.createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        type: "RETURN_REQUEST",
        initiatedById: BUYER_ID,
        initiatorRole: "BUYER",
        reason: "Missing pieces",
      }),
    );
  });

  it("records a RETURN_REQUESTED event", async () => {
    await requestReturn(BUYER_ID, ORDER_ID, "Missing pieces");

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.RETURN_REQUESTED,
        orderId: ORDER_ID,
      }),
    );
  });

  it("sends a SYSTEM notification to the seller", async () => {
    await requestReturn(BUYER_ID, ORDER_ID, "Missing pieces");

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SELLER_ID,
        title: "Return requested",
      }),
    );
  });

  it("sends a return request email to the seller", async () => {
    await requestReturn(BUYER_ID, ORDER_ID, "Missing pieces");

    // Fire-and-forget chain: allow microtasks to settle
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendReturnRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "seller@test.com",
        recipientRole: "seller",
        orderId: ORDER_ID,
        action: "REQUESTED",
      }),
    );
  });

  it("skips the email when seller email lookup returns null", async () => {
    vi.mocked(interactionRepository.findUserEmailInfo).mockResolvedValueOnce(
      null,
    );

    await requestReturn(BUYER_ID, ORDER_ID, "Missing pieces");
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendReturnRequestEmail).not.toHaveBeenCalled();
  });

  it("passes optional details through to the interaction", async () => {
    await requestReturn(BUYER_ID, ORDER_ID, "Missing pieces", {
      missingCount: 3,
    });

    expect(orderInteractionService.createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { missingCount: 3 },
      }),
    );
  });
});

// ─── respondToReturn ─────────────────────────────────────────────────────────

describe("respondToReturn — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects REJECT without a response note of at least 10 characters", async () => {
    const result = await respondToReturn(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "nope",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("at least 10");
    expect(orderInteractionService.respondToInteraction).not.toHaveBeenCalled();
  });
});

describe("respondToReturn — ACCEPT path", () => {
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

  it("marks interaction resolution as RETURNED", async () => {
    await respondToReturn(SELLER_ID, INTERACTION_ID, "ACCEPT");

    expect(
      interactionRepository.updateInteractionResolution,
    ).toHaveBeenCalledWith(
      INTERACTION_ID,
      "RETURNED",
      expect.anything(), // tx
    );
  });

  it("emits RETURN_APPROVED event", async () => {
    await respondToReturn(SELLER_ID, INTERACTION_ID, "ACCEPT");

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.RETURN_APPROVED,
        orderId: ORDER_ID,
      }),
    );
  });

  it("sends approval notification to the buyer (initiator)", async () => {
    await respondToReturn(SELLER_ID, INTERACTION_ID, "ACCEPT");

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BUYER_ID,
        title: "Return approved",
      }),
    );
  });

  it("sends an APPROVED return email to the buyer", async () => {
    // findUserEmailInfo is called for the buyer — return buyer email
    vi.mocked(interactionRepository.findUserEmailInfo).mockResolvedValueOnce({
      email: "buyer@test.com",
      displayName: "Buyer",
    } as never);

    await respondToReturn(
      SELLER_ID,
      INTERACTION_ID,
      "ACCEPT",
      "Please post it back within 7 days.",
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(sendReturnRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@test.com",
        recipientRole: "buyer",
        action: "APPROVED",
      }),
    );
  });
});

describe("respondToReturn — REJECT path", () => {
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

  it("emits RETURN_REJECTED event with the response note", async () => {
    await respondToReturn(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "All pieces were verified before shipping.",
    );

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.RETURN_REJECTED,
        metadata: expect.objectContaining({
          responseNote: "All pieces were verified before shipping.",
        }),
      }),
    );
    // No resolution update on REJECT
    expect(
      interactionRepository.updateInteractionResolution,
    ).not.toHaveBeenCalled();
  });

  it("sends rejection notification to the buyer with dispute guidance", async () => {
    await respondToReturn(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "All pieces verified before shipping.",
    );

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: BUYER_ID,
        title: "Return rejected",
      }),
    );
  });

  it("sends a REJECTED return email to the buyer", async () => {
    vi.mocked(interactionRepository.findUserEmailInfo).mockResolvedValueOnce({
      email: "buyer@test.com",
      displayName: "Buyer",
    } as never);

    await respondToReturn(
      SELLER_ID,
      INTERACTION_ID,
      "REJECT",
      "All pieces verified before shipping.",
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(sendReturnRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@test.com",
        recipientRole: "buyer",
        action: "REJECTED",
      }),
    );
  });
});
