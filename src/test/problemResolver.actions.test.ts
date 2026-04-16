// src/test/problemResolver.actions.test.ts
// ─── Tests: Unified Problem Resolver Server Action ──────────────────────────
// Covers all problem-type routing branches of submitProblem:
//   CANCEL (free window + outside window)
//   SELLER_NOT_SHIPPING (reassure + overdue)
//   CHANGED_MIND (return request)
//   PARTIAL_REFUND (validation + request)
//   NOT_RECEIVED / ITEM_DAMAGED / etc → dispute opening
//   Auth, rate limit, ownership, validation, and order-not-found paths

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock order repository ─────────────────────────────────────────────────────
const mockFindForProblemResolver = vi.fn();
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findForProblemResolver: (...args: unknown[]) =>
      mockFindForProblemResolver(...args),
  },
}));

// ── Mock orderService (cancelOrder + openDispute) ────────────────────────────
const mockCancelOrder = vi.fn();
const mockOpenDispute = vi.fn();
vi.mock("@/modules/orders/order.service", () => ({
  orderService: {
    cancelOrder: (...args: unknown[]) => mockCancelOrder(...args),
    openDispute: (...args: unknown[]) => mockOpenDispute(...args),
  },
}));

// ── Mock orderInteractionService ──────────────────────────────────────────────
const mockCreateInteraction = vi.fn();
vi.mock("@/modules/orders/order-interaction.service", () => ({
  orderInteractionService: {
    createInteraction: (...args: unknown[]) => mockCreateInteraction(...args),
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
  AUTO_ACTIONS: {
    AUTO_APPROVE: "AUTO_APPROVE",
    AUTO_REJECT: "AUTO_REJECT",
    AUTO_ESCALATE: "AUTO_ESCALATE",
  },
}));

// ── Mock notifications ────────────────────────────────────────────────────────
const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

// ── Mock auto-resolution service ──────────────────────────────────────────────
const mockQueueAutoResolution = vi.fn();
vi.mock("@/modules/disputes/auto-resolution.service", () => ({
  autoResolutionService: {
    queueAutoResolution: (...args: unknown[]) =>
      mockQueueAutoResolution(...args),
  },
}));

// ── Mock fire-and-forget (so notifications don't dangle) ─────────────────────
vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: (p: Promise<unknown>) => {
    if (p && typeof (p as Promise<unknown>).catch === "function") {
      void (p as Promise<unknown>).catch(() => undefined);
    }
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { submitProblem } = await import("@/server/actions/problemResolver");
const { rateLimit } = await import("@/server/lib/rateLimit");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_BUYER = {
  id: "user_buyer",
  email: "buyer@test.com",
  isAdmin: false,
};

/** Helper to build a mock order object. */
function mockOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "order_1",
    buyerId: TEST_BUYER.id,
    sellerId: "user_seller",
    status: "PAYMENT_HELD",
    totalNzd: 10_000, // $100 in cents
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    listing: { title: "Test Widget" },
    dispute: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth + validation guards
// ─────────────────────────────────────────────────────────────────────────────

describe("submitProblem — auth / rate limit / validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_BUYER);
    mockFindForProblemResolver.mockResolvedValue(mockOrder());
    mockCreateInteraction.mockResolvedValue({ id: "int_1" });
  });

  it("unauthenticated → returns safe error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "CANCEL",
      description: "I no longer want this item thanks.",
    });

    expect(result.success).toBe(false);
    expect(mockFindForProblemResolver).not.toHaveBeenCalled();
  });

  it("rate limit exceeded → returns Too many requests", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 120,
    });

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "CANCEL",
      description: "I no longer want this item thanks.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many/i);
    }
    expect(mockFindForProblemResolver).not.toHaveBeenCalled();
  });

  it("invalid input (description too short) → returns Zod issue message", async () => {
    const result = await submitProblem({
      orderId: "order_1",
      problemType: "CANCEL",
      description: "short",
    });

    expect(result.success).toBe(false);
    expect(mockFindForProblemResolver).not.toHaveBeenCalled();
  });

  it("invalid input (unknown problemType) → returns validation error", async () => {
    const result = await submitProblem({
      orderId: "order_1",
      problemType: "WEIRD_THING",
      description: "I no longer want this item thanks.",
    });

    expect(result.success).toBe(false);
    expect(mockFindForProblemResolver).not.toHaveBeenCalled();
  });

  it("order not found → returns Order not found error", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(null);

    const result = await submitProblem({
      orderId: "order_missing",
      problemType: "CANCEL",
      description: "I no longer want this item thanks.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/order not found/i);
    }
  });

  it("non-buyer user → returns Only the buyer error", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ buyerId: "some_other_buyer" }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "CANCEL",
      description: "I no longer want this item thanks.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/only the buyer/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL branch
// ─────────────────────────────────────────────────────────────────────────────

describe("submitProblem — CANCEL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_BUYER);
    mockCreateInteraction.mockResolvedValue({ id: "int_cancel_1" });
    mockCancelOrder.mockResolvedValue(undefined);
  });

  it("within 2h free-cancel window → cancels immediately (CANCELLED_FREE_WINDOW)", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "CANCEL",
      description: "Changed my mind within the free window.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("CANCELLED_FREE_WINDOW");
    }
    expect(mockCancelOrder).toHaveBeenCalledWith(
      "order_1",
      TEST_BUYER.id,
      "Changed my mind within the free window.",
    );
    expect(mockCreateInteraction).not.toHaveBeenCalled();
  });

  it("outside 2h window → creates CANCEL_REQUEST interaction", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
      }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "CANCEL",
      description: "I changed my mind, please cancel.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("CANCEL_REQUESTED");
      expect(result.data.interactionId).toBe("int_cancel_1");
    }
    expect(mockCreateInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_1",
        type: "CANCEL_REQUEST",
        initiatedById: TEST_BUYER.id,
        initiatorRole: "BUYER",
      }),
    );
    expect(mockCancelOrder).not.toHaveBeenCalled();
  });

  it("order already dispatched → rejects with clear message", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DISPATCHED" }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "CANCEL",
      description: "Please cancel this order thanks.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/no longer be cancelled/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SELLER_NOT_SHIPPING branch
// ─────────────────────────────────────────────────────────────────────────────

describe("submitProblem — SELLER_NOT_SHIPPING", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_BUYER);
    mockCreateInteraction.mockResolvedValue({ id: "int_delay_1" });
  });

  it("within 3 days → reassures without escalation", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "SELLER_NOT_SHIPPING",
      description: "The seller has not dispatched yet please help.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("REASSURED_WITHIN_WINDOW");
    }
    expect(mockCreateInteraction).not.toHaveBeenCalled();
  });

  it("3+ days old → creates SHIPPING_DELAY interaction", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({
        status: "PAYMENT_HELD",
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "SELLER_NOT_SHIPPING",
      description: "Seller has not shipped for five days please help.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("SHIPPING_DELAY_REPORTED");
    }
    expect(mockCreateInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SHIPPING_DELAY" }),
    );
  });

  it("order already dispatched → rejects", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DISPATCHED" }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "SELLER_NOT_SHIPPING",
      description: "Seller has not shipped for five days please help.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already been dispatched/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHANGED_MIND branch
// ─────────────────────────────────────────────────────────────────────────────

describe("submitProblem — CHANGED_MIND", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_BUYER);
    mockCreateInteraction.mockResolvedValue({ id: "int_return_1" });
  });

  it("delivered order → creates RETURN_REQUEST with auto-escalate", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DELIVERED" }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "CHANGED_MIND",
      description: "Changed my mind and would like to return the item.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("RETURN_REQUESTED");
    }
    expect(mockCreateInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "RETURN_REQUEST",
        autoAction: "AUTO_ESCALATE",
        details: expect.objectContaining({
          returnReason: "changed_mind",
          preferredResolution: "full_refund",
        }),
      }),
    );
  });

  it("non-delivered order → rejects with clear error", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "PAYMENT_HELD" }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "CHANGED_MIND",
      description: "Changed my mind and would like to return the item.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/delivered or completed/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTIAL_REFUND branch
// ─────────────────────────────────────────────────────────────────────────────

describe("submitProblem — PARTIAL_REFUND", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_BUYER);
    mockCreateInteraction.mockResolvedValue({ id: "int_refund_1" });
  });

  it("delivered order with valid amount → creates PARTIAL_REFUND_REQUEST", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DELIVERED", totalNzd: 10_000 }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "PARTIAL_REFUND",
      description: "Item arrived slightly used — requesting partial refund.",
      refundAmount: 25,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("PARTIAL_REFUND_REQUESTED");
    }
    expect(mockCreateInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PARTIAL_REFUND_REQUEST",
        details: expect.objectContaining({ currency: "NZD" }),
      }),
    );
  });

  it("missing refundAmount → rejects", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DELIVERED" }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "PARTIAL_REFUND",
      description: "Item arrived slightly used — requesting partial refund.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/refund amount/i);
    }
    expect(mockCreateInteraction).not.toHaveBeenCalled();
  });

  it("refund amount exceeds order total → rejects", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DELIVERED", totalNzd: 2_000 }), // $20 order
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "PARTIAL_REFUND",
      description: "Item arrived slightly used — requesting partial refund.",
      refundAmount: 50, // $50 > $20 order total
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/cannot exceed/i);
    }
    expect(mockCreateInteraction).not.toHaveBeenCalled();
  });

  it("order not delivered → rejects with clear error", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "PAYMENT_HELD" }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "PARTIAL_REFUND",
      description: "Item arrived slightly used — requesting partial refund.",
      refundAmount: 10,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/delivered or completed/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispute branch (ITEM_DAMAGED, NOT_AS_DESCRIBED, WRONG_ITEM, etc.)
// ─────────────────────────────────────────────────────────────────────────────

describe("submitProblem — dispute opening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_BUYER);
    mockOpenDispute.mockResolvedValue(undefined);
    mockQueueAutoResolution.mockResolvedValue({ canAutoResolve: false });
  });

  it("ITEM_DAMAGED on delivered order → opens dispute with mapped reason", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DELIVERED" }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "ITEM_DAMAGED",
      description: "The item arrived damaged and unusable.",
      evidenceKeys: ["evidence/img1.jpg"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("DISPUTE_OPENED");
    }
    expect(mockOpenDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_1",
        reason: "ITEM_DAMAGED",
        evidenceUrls: ["evidence/img1.jpg"],
      }),
      TEST_BUYER.id,
      expect.any(String), // ip
    );
  });

  it("NOT_RECEIVED on dispatched order → opens dispute", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DISPATCHED" }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "NOT_RECEIVED",
      description: "The item was marked dispatched but never arrived.",
    });

    expect(result.success).toBe(true);
    expect(mockOpenDispute).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "ITEM_NOT_RECEIVED" }),
      TEST_BUYER.id,
      expect.any(String),
    );
  });

  it("NOT_RECEIVED on a not-yet-dispatched order → rejects", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "PAYMENT_HELD" }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "NOT_RECEIVED",
      description: "The item was marked dispatched but never arrived.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/until the order has been dispatched/i);
    }
    expect(mockOpenDispute).not.toHaveBeenCalled();
  });

  it("existing open dispute → rejects with clear error", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({
        status: "DELIVERED",
        dispute: { openedAt: new Date() },
      }),
    );

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "ITEM_DAMAGED",
      description: "The item arrived damaged and unusable.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/dispute has already been opened/i);
    }
    expect(mockOpenDispute).not.toHaveBeenCalled();
  });

  it("auto-resolution queued when service flags canAutoResolve=true", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DELIVERED" }),
    );
    mockQueueAutoResolution.mockResolvedValueOnce({ canAutoResolve: true });

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "ITEM_DAMAGED",
      description: "The item arrived damaged and unusable.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoResolutionQueued).toBe(true);
    }
  });

  it("auto-resolution service throws → dispute still succeeds (best-effort)", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DELIVERED" }),
    );
    mockQueueAutoResolution.mockRejectedValueOnce(new Error("evaluator down"));

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "ITEM_DAMAGED",
      description: "The item arrived damaged and unusable.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoResolutionQueued).toBe(false);
    }
  });

  it("openDispute throws → returns safe user-facing error", async () => {
    mockFindForProblemResolver.mockResolvedValueOnce(
      mockOrder({ status: "DELIVERED" }),
    );
    mockOpenDispute.mockRejectedValueOnce(new Error("Out of scope"));

    const result = await submitProblem({
      orderId: "order_1",
      problemType: "ITEM_DAMAGED",
      description: "The item arrived damaged and unusable.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  it("MISSING_PARTS and NOT_AS_DESCRIBED map to ITEM_NOT_AS_DESCRIBED", async () => {
    mockFindForProblemResolver.mockResolvedValue(
      mockOrder({ status: "DELIVERED" }),
    );

    await submitProblem({
      orderId: "order_1",
      problemType: "MISSING_PARTS",
      description: "The box was missing several small parts inside.",
    });
    expect(mockOpenDispute).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "ITEM_NOT_AS_DESCRIBED" }),
      TEST_BUYER.id,
      expect.any(String),
    );

    await submitProblem({
      orderId: "order_1",
      problemType: "NOT_AS_DESCRIBED",
      description: "Item does not match the listing description at all.",
    });
    expect(mockOpenDispute).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "ITEM_NOT_AS_DESCRIBED" }),
      TEST_BUYER.id,
      expect.any(String),
    );
  });
});
