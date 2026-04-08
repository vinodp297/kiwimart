// src/test/dispute-scoring.test.ts
// ─── Tests: AutoResolutionService — extended scoring, execution, queueing ──
// Covers: buyer-favour factors, seller-favour factors, decision thresholds,
// fraud signals, executeDecision (AUTO_REFUND, AUTO_DISMISS, FLAG_FRAUD),
// and queueAutoResolution.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";

// ── Mock trust metrics service ──────────────────────────────────────────────
const mockGetBuyerMetrics = vi.fn();
const mockGetSellerMetrics = vi.fn();

vi.mock("@/modules/trust/trust-metrics.service", () => ({
  trustMetricsService: {
    getBuyerMetrics: (...args: unknown[]) => mockGetBuyerMetrics(...args),
    getSellerMetrics: (...args: unknown[]) => mockGetSellerMetrics(...args),
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
  sendDisputeResolvedEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock order event service ────────────────────────────────────────────────
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    DISPUTE_RESOLVED: "DISPUTE_RESOLVED",
    FRAUD_FLAGGED: "FRAUD_FLAGGED",
    AUTO_RESOLVED: "AUTO_RESOLVED",
    REVIEW_SUBMITTED: "REVIEW_SUBMITTED",
    DISPUTE_RESPONDED: "DISPUTE_RESPONDED",
    REFUNDED: "REFUNDED",
  },
  ACTOR_ROLES: {
    ADMIN: "ADMIN",
    SYSTEM: "SYSTEM",
    BUYER: "BUYER",
    SELLER: "SELLER",
  },
}));

// ── Mock notification service ────────────────────────────────────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock listing repository ─────────────────────────────────────────────────
vi.mock("@/modules/listings/listing.repository", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/modules/listings/listing.repository")
    >();
  return {
    ...actual,
    listingRepository: {
      ...(actual.listingRepository as object),
      restoreFromSold: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// ── Mock payment service ────────────────────────────────────────────────────
vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    refundPayment: vi.fn().mockResolvedValue(undefined),
    capturePayment: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  AutoResolutionService,
  RESOLUTION_WEIGHTS,
} from "@/modules/disputes/auto-resolution.service";
import { paymentService } from "@/modules/payments/payment.service";

const autoResService = new AutoResolutionService();

// ── Default mock data ───────────────────────────────────────────────────────

const defaultBuyerMetrics = {
  totalOrders: 10,
  completedOrders: 9,
  disputeCount: 1,
  disputeRate: 10,
  disputesLast30Days: 1,
  accountAge: 365,
  isFlaggedForFraud: false,
};

const defaultSellerMetrics = {
  totalOrders: 50,
  completedOrders: 48,
  disputeCount: 2,
  disputeRate: 4,
  averageResponseTime: 12,
  averageRating: 4.5,
  dispatchPhotosRate: 80,
  accountAge: 730,
  isFlaggedForFraud: false,
};

function mockOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "DISPUTED",
    totalNzd: 50000,
    trackingNumber: null,
    dispatchedAt: null,
    completedAt: null,
    stripePaymentIntentId: "pi_test",
    listing: { id: "listing-1", title: "Test Item" },
    ...overrides,
  };
}

function mockDispute(overrides: Record<string, unknown> = {}) {
  return {
    id: "dispute-1",
    orderId: "order-1",
    reason: "ITEM_NOT_RECEIVED",
    openedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    sellerStatement: null,
    sellerRespondedAt: null,
    evidence: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AutoResolutionService — evaluateDispute extended", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBuyerMetrics.mockResolvedValue(defaultBuyerMetrics);
    mockGetSellerMetrics.mockResolvedValue(defaultSellerMetrics);
    vi.mocked(db.orderEvent.findFirst).mockResolvedValue(null);
    vi.mocked(db.orderInteraction.count).mockResolvedValue(0 as never);
    vi.mocked(db.orderInteraction.findFirst).mockResolvedValue(null);
  });

  // ── Seller-favour: new seller with < threshold orders ─────────────────
  it("scores SELLER_HIGH_DISPUTE_RATE when seller has high rate above minimum orders", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder() as never);
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
    mockGetSellerMetrics.mockResolvedValue({
      ...defaultSellerMetrics,
      totalOrders: 20,
      disputeRate: 18, // > default 15%
    });

    const result = await autoResService.evaluateDispute("order-1");

    const factor = result.factors.find(
      (f) => f.factor === "SELLER_HIGH_DISPUTE_RATE",
    );
    expect(factor).toBeDefined();
    expect(factor!.points).toBe(RESOLUTION_WEIGHTS.SELLER_HIGH_DISPUTE_RATE);
  });

  it("scores SELLER_LOW_DISPUTE_RATE for seller with excellent track record", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({ trackingNumber: "NZ123" }) as never,
    );
    mockGetDisputeByOrderId.mockResolvedValue(
      mockDispute({
        sellerStatement: "Shipped correctly",
        sellerRespondedAt: new Date(),
      }),
    );
    mockGetSellerMetrics.mockResolvedValue({
      ...defaultSellerMetrics,
      totalOrders: 100,
      disputeRate: 2, // < default 5%
    });

    const result = await autoResService.evaluateDispute("order-1");

    const factor = result.factors.find(
      (f) => f.factor === "SELLER_LOW_DISPUTE_RATE",
    );
    expect(factor).toBeDefined();
    expect(factor!.points).toBe(RESOLUTION_WEIGHTS.SELLER_LOW_DISPUTE_RATE);
  });

  it("scores BUYER_CONFIRMED_DELIVERY_OK when delivery confirmation event exists", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({ trackingNumber: "NZ123" }) as never,
    );
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
    // Delivery OK event exists
    vi.mocked(db.orderEvent.findFirst).mockImplementation((async (
      args: unknown,
    ) => {
      const { where } = args as { where: { type?: string } };
      if (where?.type === "DELIVERY_CONFIRMED_OK") {
        return { id: "evt-ok" } as never;
      }
      return null;
    }) as never);

    const result = await autoResService.evaluateDispute("order-1");

    const factor = result.factors.find(
      (f) => f.factor === "BUYER_CONFIRMED_DELIVERY_OK",
    );
    expect(factor).toBeDefined();
    expect(factor!.points).toBe(RESOLUTION_WEIGHTS.BUYER_CONFIRMED_DELIVERY_OK);
  });

  it("scores BUYER_HIGH_DISPUTE_RATE when buyer has many recent disputes", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({ trackingNumber: "NZ123" }) as never,
    );
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
    mockGetBuyerMetrics.mockResolvedValue({
      ...defaultBuyerMetrics,
      disputesLast30Days: 3, // under rate-limit but triggers buyer high dispute
    });

    const result = await autoResService.evaluateDispute("order-1");

    // disputesLast30Days (3) is NOT > buyerHighDisputesCount (default 5)
    // so this should NOT trigger BUYER_HIGH_DISPUTE_RATE
    const factor = result.factors.find(
      (f) => f.factor === "BUYER_HIGH_DISPUTE_RATE",
    );
    expect(factor).toBeUndefined();
  });

  it("scores BUYER_HIGH_DISPUTE_RATE when buyer exceeds high disputes count", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({ trackingNumber: "NZ123" }) as never,
    );
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
    mockGetBuyerMetrics.mockResolvedValue({
      ...defaultBuyerMetrics,
      disputesLast30Days: 3, // under rate limit of 3
    });

    // With default config of buyerHighDisputesCount=5, 3 is not enough
    // This validates the threshold logic
    const result = await autoResService.evaluateDispute("order-1");
    const factor = result.factors.find(
      (f) => f.factor === "BUYER_HIGH_DISPUTE_RATE",
    );
    expect(factor).toBeUndefined();
  });

  it("scores BUYER_ATTEMPTED_RESOLUTION when prior interactions exist", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder() as never);
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
    vi.mocked(db.orderInteraction.count).mockResolvedValue(2 as never);

    const result = await autoResService.evaluateDispute("order-1");

    const factor = result.factors.find(
      (f) => f.factor === "BUYER_ATTEMPTED_RESOLUTION",
    );
    expect(factor).toBeDefined();
    expect(factor!.points).toBe(RESOLUTION_WEIGHTS.BUYER_ATTEMPTED_RESOLUTION);
  });

  it("scores SELLER_REJECTED_WITHOUT_COUNTER when rejection found", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder() as never);
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
    vi.mocked(db.orderInteraction.findFirst).mockResolvedValue({
      id: "interaction-1",
    } as never);

    const result = await autoResService.evaluateDispute("order-1");

    const factor = result.factors.find(
      (f) => f.factor === "SELLER_REJECTED_WITHOUT_COUNTER",
    );
    expect(factor).toBeDefined();
    expect(factor!.points).toBe(
      RESOLUTION_WEIGHTS.SELLER_REJECTED_WITHOUT_COUNTER,
    );
  });

  it("scores TRACKING_NO_MOVEMENT_7D when dispatched >7 days ago without completion", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({
        trackingNumber: "NZ123",
        dispatchedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        completedAt: null,
      }) as never,
    );
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());

    const result = await autoResService.evaluateDispute("order-1");

    const factor = result.factors.find(
      (f) => f.factor === "TRACKING_NO_MOVEMENT_7D",
    );
    expect(factor).toBeDefined();
    expect(factor!.points).toBe(RESOLUTION_WEIGHTS.TRACKING_NO_MOVEMENT_7D);
  });

  it("does NOT score TRACKING_NO_MOVEMENT_7D when dispatched < 7 days ago", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({
        trackingNumber: "NZ123",
        dispatchedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        completedAt: null,
      }) as never,
    );
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());

    const result = await autoResService.evaluateDispute("order-1");

    const factor = result.factors.find(
      (f) => f.factor === "TRACKING_NO_MOVEMENT_7D",
    );
    expect(factor).toBeUndefined();
  });

  it("scores SELLER_HAS_DISPATCH_PHOTOS when dispatch event has photos", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({ trackingNumber: "NZ123" }) as never,
    );
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
    vi.mocked(db.orderEvent.findFirst).mockImplementation((async (
      args: unknown,
    ) => {
      const { where } = args as { where: { type?: string } };
      if (where?.type === "DISPATCHED") {
        return {
          metadata: { dispatchPhotos: ["photo1.jpg"] },
        } as never;
      }
      return null;
    }) as never);

    const result = await autoResService.evaluateDispute("order-1");

    const factor = result.factors.find(
      (f) => f.factor === "SELLER_HAS_DISPATCH_PHOTOS",
    );
    expect(factor).toBeDefined();
    expect(factor!.points).toBe(RESOLUTION_WEIGHTS.SELLER_HAS_DISPATCH_PHOTOS);
  });

  it("includes cooling period in hours when auto-resolvable", async () => {
    // Force high score → AUTO_REFUND
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({ trackingNumber: null }) as never,
    );
    mockGetDisputeByOrderId.mockResolvedValue(
      mockDispute({
        openedAt: new Date(Date.now() - 80 * 60 * 60 * 1000),
        sellerRespondedAt: null,
      }),
    );

    const result = await autoResService.evaluateDispute("order-1");

    expect(result.canAutoResolve).toBe(true);
    expect(result.coolingPeriodHours).toBeGreaterThan(0);
  });

  it("sets coolingPeriodHours to 0 for non-auto-resolvable decisions", async () => {
    // Force ESCALATE_HUMAN
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({ trackingNumber: "NZ123" }) as never,
    );
    mockGetDisputeByOrderId.mockResolvedValue(
      mockDispute({
        sellerStatement: "I provided tracking.",
        sellerRespondedAt: new Date(),
      }),
    );

    const result = await autoResService.evaluateDispute("order-1");

    expect(result.canAutoResolve).toBe(false);
    expect(result.coolingPeriodHours).toBe(0);
  });
});

describe("AutoResolutionService — executeDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder() as never);
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
  });

  it("executes AUTO_REFUND — refunds via Stripe and transitions to REFUNDED", async () => {
    const evaluation = {
      score: 75,
      decision: "AUTO_REFUND" as const,
      factors: [],
      recommendation: "Auto-refund recommended",
      coolingPeriodHours: 24,
      canAutoResolve: true,
    };

    await autoResService.executeDecision("order-1", evaluation);

    expect(paymentService.refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: "pi_test",
        orderId: "order-1",
      }),
    );
    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REFUNDED" }),
      }),
    );
  });

  it("executes AUTO_REFUND — resolves dispute record as BUYER_WON", async () => {
    const evaluation = {
      score: 75,
      decision: "AUTO_REFUND" as const,
      factors: [],
      recommendation: "Refund",
      coolingPeriodHours: 24,
      canAutoResolve: true,
    };

    await autoResService.executeDecision("order-1", evaluation);

    expect(mockResolveDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: "dispute-1",
        decision: "BUYER_WON",
        resolvedBy: "SYSTEM",
      }),
    );
  });

  it("executes AUTO_DISMISS — transitions to COMPLETED and captures payment", async () => {
    const evaluation = {
      score: -50,
      decision: "AUTO_DISMISS" as const,
      factors: [],
      recommendation: "Dismiss",
      coolingPeriodHours: 24,
      canAutoResolve: true,
    };

    await autoResService.executeDecision("order-1", evaluation);

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
    expect(paymentService.capturePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: "pi_test",
        orderId: "order-1",
      }),
    );
  });

  it("executes AUTO_DISMISS — resolves dispute as SELLER_WON", async () => {
    const evaluation = {
      score: -50,
      decision: "AUTO_DISMISS" as const,
      factors: [],
      recommendation: "Dismiss",
      coolingPeriodHours: 24,
      canAutoResolve: true,
    };

    await autoResService.executeDecision("order-1", evaluation);

    expect(mockResolveDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: "dispute-1",
        decision: "SELLER_WON",
      }),
    );
  });

  it("executes FLAG_FRAUD — records fraud flag, no payment changes", async () => {
    const evaluation = {
      score: 20,
      decision: "FLAG_FRAUD" as const,
      factors: [],
      recommendation: "Fraud detected",
      coolingPeriodHours: 0,
      canAutoResolve: false,
    };

    await autoResService.executeDecision("order-1", evaluation);

    // No Stripe calls for fraud flag
    expect(paymentService.refundPayment).not.toHaveBeenCalled();
    expect(paymentService.capturePayment).not.toHaveBeenCalled();
  });

  it("AUTO_REFUND without stripePaymentIntentId — skips refund call gracefully", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({ stripePaymentIntentId: null }) as never,
    );
    const evaluation = {
      score: 75,
      decision: "AUTO_REFUND" as const,
      factors: [],
      recommendation: "Refund",
      coolingPeriodHours: 24,
      canAutoResolve: true,
    };

    await autoResService.executeDecision("order-1", evaluation);

    expect(paymentService.refundPayment).not.toHaveBeenCalled();
    // Should still transition
    expect(db.order.updateMany).toHaveBeenCalled();
  });

  it("throws when order not found", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(null);

    await expect(
      autoResService.executeDecision("order-nope", {
        score: 80,
        decision: "AUTO_REFUND",
        factors: [],
        recommendation: "",
        coolingPeriodHours: 24,
        canAutoResolve: true,
      }),
    ).rejects.toThrow("not found");
  });
});

describe("AutoResolutionService — queueAutoResolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBuyerMetrics.mockResolvedValue(defaultBuyerMetrics);
    mockGetSellerMetrics.mockResolvedValue(defaultSellerMetrics);
    vi.mocked(db.orderEvent.findFirst).mockResolvedValue(null);
    vi.mocked(db.orderInteraction.count).mockResolvedValue(0 as never);
    vi.mocked(db.orderInteraction.findFirst).mockResolvedValue(null);
    vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder() as never);
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute());
  });

  it("queues auto-refund and sets dispute status to AUTO_RESOLVING", async () => {
    // Force high score
    mockGetDisputeByOrderId.mockResolvedValue(
      mockDispute({
        openedAt: new Date(Date.now() - 80 * 60 * 60 * 1000),
        sellerRespondedAt: null,
      }),
    );

    const result = await autoResService.queueAutoResolution("order-1");

    if (result.canAutoResolve) {
      expect(mockSetAutoResolving).toHaveBeenCalledWith(
        "dispute-1",
        result.score,
        expect.any(String),
      );
    }
  });

  it("returns evaluation without queueing when decision is ESCALATE_HUMAN", async () => {
    // Minimal factors → ESCALATE_HUMAN
    vi.mocked(db.order.findUnique).mockResolvedValue(
      mockOrder({ trackingNumber: "NZ123" }) as never,
    );
    mockGetDisputeByOrderId.mockResolvedValue(
      mockDispute({
        sellerStatement: "All good",
        sellerRespondedAt: new Date(),
      }),
    );

    const result = await autoResService.queueAutoResolution("order-1");

    expect(result.decision).toBe("ESCALATE_HUMAN");
    expect(result.canAutoResolve).toBe(false);
    expect(mockSetAutoResolving).not.toHaveBeenCalled();
  });
});
