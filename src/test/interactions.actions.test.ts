// src/test/interactions.actions.test.ts
// ─── Tests: Order Interaction Server Actions ────────────────────────────────
// Covers all 9 exported actions:
//   requestCancellation, respondToCancellation, requestReturn, respondToReturn,
//   requestPartialRefund, respondToPartialRefund, notifyShippingDelay,
//   respondToShippingDelay, getOrderInteractions

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock interactionWorkflowService BEFORE import ────────────────────────────
const mockRequestCancellation = vi.fn();
const mockRespondToCancellation = vi.fn();
const mockRequestReturn = vi.fn();
const mockRespondToReturn = vi.fn();
const mockRequestPartialRefund = vi.fn();
const mockRespondToPartialRefund = vi.fn();
const mockNotifyShippingDelay = vi.fn();
const mockRespondToShippingDelay = vi.fn();
const mockGetOrderInteractions = vi.fn();

vi.mock("@/modules/orders/interaction-workflow.instance", () => ({
  interactionWorkflowService: {
    requestCancellation: (...args: unknown[]) =>
      mockRequestCancellation(...args),
    respondToCancellation: (...args: unknown[]) =>
      mockRespondToCancellation(...args),
    requestReturn: (...args: unknown[]) => mockRequestReturn(...args),
    respondToReturn: (...args: unknown[]) => mockRespondToReturn(...args),
    requestPartialRefund: (...args: unknown[]) =>
      mockRequestPartialRefund(...args),
    respondToPartialRefund: (...args: unknown[]) =>
      mockRespondToPartialRefund(...args),
    notifyShippingDelay: (...args: unknown[]) =>
      mockNotifyShippingDelay(...args),
    respondToShippingDelay: (...args: unknown[]) =>
      mockRespondToShippingDelay(...args),
    getOrderInteractions: (...args: unknown[]) =>
      mockGetOrderInteractions(...args),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const {
  requestCancellation,
  respondToCancellation,
  requestReturn,
  respondToReturn,
  requestPartialRefund,
  respondToPartialRefund,
  notifyShippingDelay,
  respondToShippingDelay,
  getOrderInteractions,
} = await import("@/server/actions/interactions");

// ── Test user fixture ─────────────────────────────────────────────────────────
const TEST_USER = { id: "user_buyer", email: "buyer@test.com", isAdmin: false };

// ─────────────────────────────────────────────────────────────────────────────
// requestCancellation
// ─────────────────────────────────────────────────────────────────────────────

describe("requestCancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockRequestCancellation.mockResolvedValue({
      ok: true,
      data: { autoApproved: false, interactionId: "int_cancel_1" },
    });
  });

  it("unauthenticated → returns auth error and does not call service", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await requestCancellation({
      orderId: "order_1",
      reason: "I no longer want this item.",
    });

    expect(result.success).toBe(false);
    expect(mockRequestCancellation).not.toHaveBeenCalled();
  });

  it("invalid input (missing orderId) → returns validation error", async () => {
    const result = await requestCancellation({
      reason: "I no longer want this item.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
    expect(mockRequestCancellation).not.toHaveBeenCalled();
  });

  it("invalid input (reason too short) → returns validation error", async () => {
    const result = await requestCancellation({
      orderId: "order_1",
      reason: "short",
    });

    expect(result.success).toBe(false);
    expect(mockRequestCancellation).not.toHaveBeenCalled();
  });

  it("happy path → returns autoApproved result", async () => {
    const result = await requestCancellation({
      orderId: "order_1",
      reason: "I changed my mind about this purchase.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoApproved).toBe(false);
      expect(result.data.interactionId).toBe("int_cancel_1");
    }
    expect(mockRequestCancellation).toHaveBeenCalledWith(
      "user_buyer",
      "order_1",
      "I changed my mind about this purchase.",
    );
  });

  it("service returns ok:false → propagates error message", async () => {
    mockRequestCancellation.mockResolvedValueOnce({
      ok: false,
      error: "Cancellation window has expired.",
    });

    const result = await requestCancellation({
      orderId: "order_1",
      reason: "I changed my mind about this purchase.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Cancellation window has expired.");
    }
  });

  it("service throws → returns safe fallback error", async () => {
    mockRequestCancellation.mockRejectedValueOnce(
      new Error("Unexpected DB error"),
    );

    const result = await requestCancellation({
      orderId: "order_1",
      reason: "I changed my mind about this purchase.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// respondToCancellation
// ─────────────────────────────────────────────────────────────────────────────

describe("respondToCancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockRespondToCancellation.mockResolvedValue({ ok: true });
  });

  it("unauthenticated → returns auth error and does not call service", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await respondToCancellation({
      interactionId: "int_1",
      action: "ACCEPT",
    });

    expect(result.success).toBe(false);
    expect(mockRespondToCancellation).not.toHaveBeenCalled();
  });

  it("invalid input (bad action value) → returns validation error", async () => {
    const result = await respondToCancellation({
      interactionId: "int_1",
      action: "APPROVE", // invalid enum value
    });

    expect(result.success).toBe(false);
    expect(mockRespondToCancellation).not.toHaveBeenCalled();
  });

  it("invalid input (missing interactionId) → returns validation error", async () => {
    const result = await respondToCancellation({ action: "ACCEPT" });

    expect(result.success).toBe(false);
    expect(mockRespondToCancellation).not.toHaveBeenCalled();
  });

  it("happy path ACCEPT → calls service with correct args", async () => {
    const result = await respondToCancellation({
      interactionId: "int_1",
      action: "ACCEPT",
      responseNote: "Happy to cancel.",
    });

    expect(result.success).toBe(true);
    expect(mockRespondToCancellation).toHaveBeenCalledWith(
      "user_buyer",
      "int_1",
      "ACCEPT",
      "Happy to cancel.",
    );
  });

  it("happy path REJECT without responseNote → calls service with undefined note", async () => {
    const result = await respondToCancellation({
      interactionId: "int_1",
      action: "REJECT",
    });

    expect(result.success).toBe(true);
    expect(mockRespondToCancellation).toHaveBeenCalledWith(
      "user_buyer",
      "int_1",
      "REJECT",
      undefined,
    );
  });

  it("service returns ok:false → propagates error", async () => {
    mockRespondToCancellation.mockResolvedValueOnce({
      ok: false,
      error: "Interaction not found or already resolved.",
    });

    const result = await respondToCancellation({
      interactionId: "int_1",
      action: "ACCEPT",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Interaction not found or already resolved.");
    }
  });

  it("service throws → returns safe fallback error", async () => {
    mockRespondToCancellation.mockRejectedValueOnce(new Error("Network error"));

    const result = await respondToCancellation({
      interactionId: "int_1",
      action: "ACCEPT",
    });

    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requestReturn
// ─────────────────────────────────────────────────────────────────────────────

describe("requestReturn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockRequestReturn.mockResolvedValue({
      ok: true,
      data: { interactionId: "int_return_1" },
    });
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await requestReturn({
      orderId: "order_1",
      reason: "Item arrived damaged and not as described.",
    });

    expect(result.success).toBe(false);
    expect(mockRequestReturn).not.toHaveBeenCalled();
  });

  it("invalid input (reason too short) → returns validation error", async () => {
    const result = await requestReturn({
      orderId: "order_1",
      reason: "bad",
    });

    expect(result.success).toBe(false);
    expect(mockRequestReturn).not.toHaveBeenCalled();
  });

  it("happy path without optional details → returns interactionId", async () => {
    const result = await requestReturn({
      orderId: "order_1",
      reason: "Item arrived damaged and not as described.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interactionId).toBe("int_return_1");
    }
    expect(mockRequestReturn).toHaveBeenCalledWith(
      "user_buyer",
      "order_1",
      "Item arrived damaged and not as described.",
      undefined,
    );
  });

  it("happy path with optional details → passes details to service", async () => {
    const details = {
      returnReason: "damaged" as const,
      preferredResolution: "full_refund" as const,
    };

    const result = await requestReturn({
      orderId: "order_1",
      reason: "Item arrived damaged and not as described.",
      details,
    });

    expect(result.success).toBe(true);
    expect(mockRequestReturn).toHaveBeenCalledWith(
      "user_buyer",
      "order_1",
      "Item arrived damaged and not as described.",
      details,
    );
  });

  it("service returns ok:false → propagates error", async () => {
    mockRequestReturn.mockResolvedValueOnce({
      ok: false,
      error: "Return window has expired.",
    });

    const result = await requestReturn({
      orderId: "order_1",
      reason: "Item arrived damaged and not as described.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Return window has expired.");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// respondToReturn
// ─────────────────────────────────────────────────────────────────────────────

describe("respondToReturn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockRespondToReturn.mockResolvedValue({ ok: true });
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await respondToReturn({
      interactionId: "int_1",
      action: "ACCEPT",
    });

    expect(result.success).toBe(false);
    expect(mockRespondToReturn).not.toHaveBeenCalled();
  });

  it("happy path ACCEPT → returns success", async () => {
    const result = await respondToReturn({
      interactionId: "int_1",
      action: "ACCEPT",
      responseNote: "Please ship back within 7 days.",
    });

    expect(result.success).toBe(true);
    expect(mockRespondToReturn).toHaveBeenCalledWith(
      "user_buyer",
      "int_1",
      "ACCEPT",
      "Please ship back within 7 days.",
    );
  });

  it("service returns ok:false → propagates error", async () => {
    mockRespondToReturn.mockResolvedValueOnce({
      ok: false,
      error: "Only the seller can respond to return requests.",
    });

    const result = await respondToReturn({
      interactionId: "int_1",
      action: "REJECT",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(
        "Only the seller can respond to return requests.",
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requestPartialRefund
// ─────────────────────────────────────────────────────────────────────────────

describe("requestPartialRefund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockRequestPartialRefund.mockResolvedValue({
      ok: true,
      data: { interactionId: "int_refund_1" },
    });
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await requestPartialRefund({
      orderId: "order_1",
      reason: "Item was damaged on arrival.",
      amount: 25,
    });

    expect(result.success).toBe(false);
    expect(mockRequestPartialRefund).not.toHaveBeenCalled();
  });

  it("invalid input (non-positive amount) → returns validation error", async () => {
    const result = await requestPartialRefund({
      orderId: "order_1",
      reason: "Item was damaged on arrival.",
      amount: -10,
    });

    expect(result.success).toBe(false);
    expect(mockRequestPartialRefund).not.toHaveBeenCalled();
  });

  it("invalid input (zero amount) → returns validation error", async () => {
    const result = await requestPartialRefund({
      orderId: "order_1",
      reason: "Item was damaged on arrival.",
      amount: 0,
    });

    expect(result.success).toBe(false);
    expect(mockRequestPartialRefund).not.toHaveBeenCalled();
  });

  it("invalid input (reason too short) → returns validation error", async () => {
    const result = await requestPartialRefund({
      orderId: "order_1",
      reason: "short",
      amount: 25,
    });

    expect(result.success).toBe(false);
    expect(mockRequestPartialRefund).not.toHaveBeenCalled();
  });

  it("happy path → returns interactionId", async () => {
    const result = await requestPartialRefund({
      orderId: "order_1",
      reason: "Item was damaged on arrival, requesting partial refund.",
      amount: 25,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interactionId).toBe("int_refund_1");
    }
    expect(mockRequestPartialRefund).toHaveBeenCalledWith(
      "user_buyer",
      "order_1",
      "Item was damaged on arrival, requesting partial refund.",
      25,
    );
  });

  it("service returns ok:false → propagates error", async () => {
    mockRequestPartialRefund.mockResolvedValueOnce({
      ok: false,
      error: "Order is not eligible for partial refund.",
    });

    const result = await requestPartialRefund({
      orderId: "order_1",
      reason: "Item was damaged on arrival, requesting partial refund.",
      amount: 25,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Order is not eligible for partial refund.");
    }
  });

  it("service throws → returns safe fallback error", async () => {
    mockRequestPartialRefund.mockRejectedValueOnce(
      new Error("Unexpected error"),
    );

    const result = await requestPartialRefund({
      orderId: "order_1",
      reason: "Item was damaged on arrival, requesting partial refund.",
      amount: 25,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// respondToPartialRefund
// ─────────────────────────────────────────────────────────────────────────────

describe("respondToPartialRefund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockRespondToPartialRefund.mockResolvedValue({ ok: true });
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await respondToPartialRefund({
      interactionId: "int_1",
      action: "ACCEPT",
    });

    expect(result.success).toBe(false);
    expect(mockRespondToPartialRefund).not.toHaveBeenCalled();
  });

  it("invalid action value → returns validation error", async () => {
    const result = await respondToPartialRefund({
      interactionId: "int_1",
      action: "APPROVE", // invalid
    });

    expect(result.success).toBe(false);
    expect(mockRespondToPartialRefund).not.toHaveBeenCalled();
  });

  it("happy path ACCEPT → calls service correctly", async () => {
    const result = await respondToPartialRefund({
      interactionId: "int_1",
      action: "ACCEPT",
      responseNote: "Agreed, refunding $25.",
    });

    expect(result.success).toBe(true);
    expect(mockRespondToPartialRefund).toHaveBeenCalledWith(
      "user_buyer",
      "int_1",
      "ACCEPT",
      "Agreed, refunding $25.",
      undefined,
    );
  });

  it("happy path COUNTER with counterAmount → passes amount to service", async () => {
    const result = await respondToPartialRefund({
      interactionId: "int_1",
      action: "COUNTER",
      responseNote: "I can offer $15 instead.",
      counterAmount: 15,
    });

    expect(result.success).toBe(true);
    expect(mockRespondToPartialRefund).toHaveBeenCalledWith(
      "user_buyer",
      "int_1",
      "COUNTER",
      "I can offer $15 instead.",
      15,
    );
  });

  it("happy path REJECT → calls service correctly", async () => {
    const result = await respondToPartialRefund({
      interactionId: "int_1",
      action: "REJECT",
    });

    expect(result.success).toBe(true);
    expect(mockRespondToPartialRefund).toHaveBeenCalledWith(
      "user_buyer",
      "int_1",
      "REJECT",
      undefined,
      undefined,
    );
  });

  it("service returns ok:false → propagates error", async () => {
    mockRespondToPartialRefund.mockResolvedValueOnce({
      ok: false,
      error: "Interaction already resolved.",
    });

    const result = await respondToPartialRefund({
      interactionId: "int_1",
      action: "ACCEPT",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Interaction already resolved.");
    }
  });

  it("service throws → returns safe fallback error", async () => {
    mockRespondToPartialRefund.mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    const result = await respondToPartialRefund({
      interactionId: "int_1",
      action: "ACCEPT",
    });

    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// notifyShippingDelay
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyShippingDelay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockNotifyShippingDelay.mockResolvedValue({
      ok: true,
      data: { interactionId: "int_delay_1" },
    });
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await notifyShippingDelay({
      orderId: "order_1",
      reason: "Postal delays due to public holiday weekend.",
    });

    expect(result.success).toBe(false);
    expect(mockNotifyShippingDelay).not.toHaveBeenCalled();
  });

  it("happy path without estimatedNewDate → returns interactionId", async () => {
    const result = await notifyShippingDelay({
      orderId: "order_1",
      reason: "Postal delays due to public holiday weekend.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interactionId).toBe("int_delay_1");
    }
    expect(mockNotifyShippingDelay).toHaveBeenCalledWith(
      "user_buyer",
      "order_1",
      "Postal delays due to public holiday weekend.",
      undefined,
    );
  });

  it("happy path with estimatedNewDate → passes date to service", async () => {
    const result = await notifyShippingDelay({
      orderId: "order_1",
      reason: "Postal delays due to public holiday weekend.",
      estimatedNewDate: "2026-05-01",
    });

    expect(result.success).toBe(true);
    expect(mockNotifyShippingDelay).toHaveBeenCalledWith(
      "user_buyer",
      "order_1",
      "Postal delays due to public holiday weekend.",
      "2026-05-01",
    );
  });

  it("service returns ok:false → propagates error", async () => {
    mockNotifyShippingDelay.mockResolvedValueOnce({
      ok: false,
      error: "Order is already delivered.",
    });

    const result = await notifyShippingDelay({
      orderId: "order_1",
      reason: "Postal delays due to public holiday weekend.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Order is already delivered.");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// respondToShippingDelay
// ─────────────────────────────────────────────────────────────────────────────

describe("respondToShippingDelay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockRespondToShippingDelay.mockResolvedValue({ ok: true });
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await respondToShippingDelay({
      interactionId: "int_1",
      action: "ACCEPT",
    });

    expect(result.success).toBe(false);
    expect(mockRespondToShippingDelay).not.toHaveBeenCalled();
  });

  it("happy path ACCEPT → calls service correctly", async () => {
    const result = await respondToShippingDelay({
      interactionId: "int_1",
      action: "ACCEPT",
    });

    expect(result.success).toBe(true);
    expect(mockRespondToShippingDelay).toHaveBeenCalledWith(
      "user_buyer",
      "int_1",
      "ACCEPT",
      undefined,
    );
  });

  it("service returns ok:false → propagates error", async () => {
    mockRespondToShippingDelay.mockResolvedValueOnce({
      ok: false,
      error: "Interaction expired.",
    });

    const result = await respondToShippingDelay({
      interactionId: "int_1",
      action: "REJECT",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Interaction expired.");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getOrderInteractions
// ─────────────────────────────────────────────────────────────────────────────

describe("getOrderInteractions", () => {
  const mockInteraction = {
    id: "int_1",
    type: "CANCELLATION",
    status: "PENDING",
    initiatorRole: "BUYER",
    reason: "No longer needed",
    details: null,
    responseNote: null,
    expiresAt: "2026-05-01T00:00:00Z",
    autoAction: "APPROVE",
    resolvedAt: null,
    resolution: null,
    createdAt: "2026-04-14T10:00:00Z",
    initiator: { id: "user_buyer", displayName: "Buyer", username: "buyer" },
    responder: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockGetOrderInteractions.mockResolvedValue({
      ok: true,
      data: [mockInteraction],
    });
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await getOrderInteractions("order_1");

    expect(result.success).toBe(false);
    expect(mockGetOrderInteractions).not.toHaveBeenCalled();
  });

  it("happy path → returns list of interactions", async () => {
    const result = await getOrderInteractions("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.id).toBe("int_1");
    }
    expect(mockGetOrderInteractions).toHaveBeenCalledWith(
      "order_1",
      "user_buyer",
      false,
    );
  });

  it("admin user → passes isAdmin=true to service", async () => {
    mockRequireUser.mockResolvedValueOnce({
      id: "user_admin",
      email: "admin@test.com",
      isAdmin: true,
    });

    await getOrderInteractions("order_1");

    expect(mockGetOrderInteractions).toHaveBeenCalledWith(
      "order_1",
      "user_admin",
      true,
    );
  });

  it("service returns ok:false → propagates error", async () => {
    mockGetOrderInteractions.mockResolvedValueOnce({
      ok: false,
      error: "Order not found.",
    });

    const result = await getOrderInteractions("order_1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Order not found.");
    }
  });

  it("service throws → returns fallback error message", async () => {
    mockGetOrderInteractions.mockRejectedValueOnce(
      new Error("Unexpected failure"),
    );

    const result = await getOrderInteractions("order_1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Could not load order interactions.");
    }
  });
});
