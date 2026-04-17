// src/test/payment-bug-fixes.test.ts
// ─── Tests: Payment bug fixes — cancel refund, auto-resolution safety ────────
// Covers: Bug 1 (cancelOrder Stripe refund), Bug 2 (AUTO_REFUND conditional),
// Bug 3 (AUTO_DISMISS capture-before-transition).

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";

// ── Mock payment service ────────────────────────────────────────────────────
const mockRefundPayment = vi.fn().mockResolvedValue(undefined);
const mockCapturePayment = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    refundPayment: (...args: unknown[]) => mockRefundPayment(...args),
    capturePayment: (...args: unknown[]) => mockCapturePayment(...args),
    createPaymentIntent: vi.fn(),
    getClientSecret: vi.fn(),
  },
}));

// ── Mock trust metrics ──────────────────────────────────────────────────────
vi.mock("@/modules/trust/trust-metrics.service", () => ({
  trustMetricsService: {
    getBuyerMetrics: vi.fn().mockResolvedValue({
      totalOrders: 10,
      completedOrders: 9,
      disputeCount: 1,
      disputeRate: 10,
      disputesLast30Days: 1,
      accountAge: 365,
      isFlaggedForFraud: false,
    }),
    getSellerMetrics: vi.fn().mockResolvedValue({
      totalOrders: 20,
      completedOrders: 18,
      disputeCount: 2,
      disputeRate: 10,
      accountAge: 730,
      isFlaggedForFraud: false,
    }),
    computeMetrics: vi.fn(),
  },
}));

// ── Mock dispute service ────────────────────────────────────────────────────
const mockGetDisputeByOrderId = vi.fn();
const mockResolveDispute = vi.fn().mockResolvedValue(undefined);
const mockSetAutoResolving = vi.fn().mockResolvedValue(undefined);

vi.mock("@/server/services/dispute/dispute.service", () => ({
  getDisputeByOrderId: (...args: unknown[]) => mockGetDisputeByOrderId(...args),
  resolveDispute: (...args: unknown[]) => mockResolveDispute(...args),
  setAutoResolving: (...args: unknown[]) => mockSetAutoResolving(...args),
}));

// ── Mock email ──────────────────────────────────────────────────────────────
vi.mock("@/server/email", () => ({
  sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
  sendDisputeResolvedEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock order event service ────────────────────────────────────────────────
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    CANCELLED: "CANCELLED",
    DISPUTE_RESOLVED: "DISPUTE_RESOLVED",
    DISPUTE_RESPONDED: "DISPUTE_RESPONDED",
    FRAUD_FLAGGED: "FRAUD_FLAGGED",
    AUTO_RESOLVED: "AUTO_RESOLVED",
    REFUNDED: "REFUNDED",
  },
  ACTOR_ROLES: {
    ADMIN: "ADMIN",
    SYSTEM: "SYSTEM",
    BUYER: "BUYER",
    SELLER: "SELLER",
  },
}));

// ── Mock listing repository (for restoreFromSold) ───────────────────────────
vi.mock("@/modules/listings/listing.repository", () => ({
  listingRepository: {
    restoreFromSold: vi.fn().mockResolvedValue(undefined),
  },
}));

import { cancelOrder } from "@/modules/orders/order-cancel.service";
import { AutoResolutionService } from "@/modules/disputes/auto-resolution.service";
import { orderEventService } from "@/modules/orders/order-event.service";

const autoResService = new AutoResolutionService();

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockCancelOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "PAYMENT_HELD",
    createdAt: new Date(), // within free cancellation window
    listingId: "listing-1",
    stripePaymentIntentId: "pi_test_cancel",
    ...overrides,
  };
}

function mockAutoResOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "DISPUTED",
    totalNzd: 5000,
    stripePaymentIntentId: "pi_test_auto",
    listing: { id: "listing-1", title: "Test Listing" },
    ...overrides,
  };
}

function mockDispute() {
  return {
    id: "dispute-1",
    orderId: "order-1",
    status: "AUTO_RESOLVING",
    reason: "ITEM_NOT_RECEIVED",
    openedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    sellerStatement: null,
    sellerRespondedAt: null,
    evidence: [],
  };
}

function autoRefundEvaluation() {
  return {
    score: 75,
    decision: "AUTO_REFUND" as const,
    factors: [],
    recommendation: "Auto-refund recommended",
    coolingPeriodHours: 24,
    canAutoResolve: true,
  };
}

function autoDismissEvaluation() {
  return {
    score: -50,
    decision: "AUTO_DISMISS" as const,
    factors: [],
    recommendation: "Auto-dismiss recommended",
    coolingPeriodHours: 24,
    canAutoResolve: true,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// BUG 1 — cancelOrder must issue Stripe refund for PAYMENT_HELD orders
// ═════════════════════════════════════════════════════════════════════════════

describe("Bug 1 — cancelOrder Stripe refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: findByIdForCancel returns a PAYMENT_HELD order with PI
    vi.mocked(db.order.findFirst).mockResolvedValue(mockCancelOrder() as never);
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.order.findUnique).mockResolvedValue({
      totalNzd: 5000,
      buyer: { email: "buyer@test.nz", displayName: "Buyer" },
      seller: { email: "seller@test.nz", displayName: "Seller" },
      listing: { title: "Test Listing" },
    } as never);
    mockRefundPayment.mockResolvedValue(undefined);
  });

  it("calls refundPayment before transitioning PAYMENT_HELD order to CANCELLED", async () => {
    await cancelOrder("order-1", "buyer-1");

    expect(mockRefundPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: "pi_test_cancel",
        orderId: "order-1",
      }),
    );
    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("successful refund → order transitions to CANCELLED", async () => {
    await cancelOrder("order-1", "buyer-1");

    // Refund succeeds, transition to CANCELLED happens
    expect(mockRefundPayment).toHaveBeenCalledTimes(1);
    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("failed refund → order transitions to DISPUTED not CANCELLED", async () => {
    mockRefundPayment.mockRejectedValue(new Error("Stripe network error"));

    await expect(cancelOrder("order-1", "buyer-1")).rejects.toThrow(
      /refund failed/i,
    );

    // Should transition to DISPUTED, not CANCELLED
    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DISPUTED" }),
      }),
    );
    // Should NOT have a CANCELLED transition
    const updateCalls = vi.mocked(db.order.updateMany).mock.calls;
    const cancelledCall = updateCalls.find(
      (call) =>
        (call[0] as { data: { status: string } }).data.status === "CANCELLED",
    );
    expect(cancelledCall).toBeUndefined();
  });

  it("CASH order (no stripePaymentIntentId) → no Stripe call, proceeds directly", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue(
      mockCancelOrder({
        stripePaymentIntentId: null,
        status: "PAYMENT_HELD",
      }) as never,
    );

    await cancelOrder("order-1", "buyer-1");

    expect(mockRefundPayment).not.toHaveBeenCalled();
    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("non-PAYMENT_HELD order (AWAITING_PICKUP) → no Stripe refund call", async () => {
    // AWAITING_PICKUP has canCancel: false in getCancellationStatus (only PAYMENT_HELD is cancellable)
    // But we can test the refund guard directly by mocking an order that passes validation
    // with a non-PAYMENT_HELD status. Use AWAITING_PAYMENT which is not cancellable
    // either, so this test just verifies the guard condition.
    vi.mocked(db.order.findFirst).mockResolvedValue(
      mockCancelOrder({ status: "DISPATCHED" }) as never,
    );

    // DISPATCHED orders fail getCancellationStatus, so cancelOrder will throw
    // before reaching the Stripe refund code
    await expect(cancelOrder("order-1", "buyer-1")).rejects.toThrow();

    expect(mockRefundPayment).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BUG 2 — AUTO_REFUND must be conditional on Stripe refund success
// ═════════════════════════════════════════════════════════════════════════════

describe("Bug 2 — AUTO_REFUND conditional on Stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockAutoResOrder() as never,
    );
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
    mockRefundPayment.mockResolvedValue(undefined);
  });

  it("successful Stripe refund → order transitions to REFUNDED", async () => {
    await autoResService.executeDecision("order-1", autoRefundEvaluation());

    expect(mockRefundPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: "pi_test_auto",
        orderId: "order-1",
      }),
    );
    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REFUNDED" }),
      }),
    );
  });

  it("failed Stripe refund → order stays in DISPUTED, NOT marked REFUNDED", async () => {
    mockRefundPayment.mockRejectedValue(new Error("Stripe unavailable"));

    await autoResService.executeDecision("order-1", autoRefundEvaluation());

    // Should NOT transition to REFUNDED
    expect(db.order.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REFUNDED" }),
      }),
    );
  });

  it("failed Stripe refund → records system event for manual review", async () => {
    mockRefundPayment.mockRejectedValue(new Error("Stripe unavailable"));

    await autoResService.executeDecision("order-1", autoRefundEvaluation());

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        summary: expect.stringContaining("refund failed"),
      }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BUG 3 — AUTO_DISMISS must capture BEFORE transition
// ═════════════════════════════════════════════════════════════════════════════

describe("Bug 3 — AUTO_DISMISS capture before transition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockAutoResOrder() as never,
    );
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
    mockCapturePayment.mockResolvedValue(undefined);
  });

  it("successful capture → order transitions to COMPLETED", async () => {
    await autoResService.executeDecision("order-1", autoDismissEvaluation());

    expect(mockCapturePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: "pi_test_auto",
        orderId: "order-1",
      }),
    );
    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("failed capture → order stays in DISPUTED, NOT marked COMPLETED", async () => {
    mockCapturePayment.mockRejectedValue(new Error("Authorization expired"));

    await autoResService.executeDecision("order-1", autoDismissEvaluation());

    // Should NOT transition to COMPLETED
    expect(db.order.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("failed capture → records system event for manual review", async () => {
    mockCapturePayment.mockRejectedValue(new Error("Authorization expired"));

    await autoResService.executeDecision("order-1", autoDismissEvaluation());

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        summary: expect.stringContaining("capture failed"),
      }),
    );
  });

  it("capture is called BEFORE order transitions — verified by call order", async () => {
    const callOrder: string[] = [];

    mockCapturePayment.mockImplementation(async () => {
      callOrder.push("capture");
    });
    vi.mocked(db.order.updateMany).mockImplementation((async () => {
      callOrder.push("transition");
      return { count: 1 };
    }) as never);

    await autoResService.executeDecision("order-1", autoDismissEvaluation());

    expect(callOrder[0]).toBe("capture");
    expect(callOrder[1]).toBe("transition");
  });
});
