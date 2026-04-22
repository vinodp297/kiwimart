// src/test/admin-dispute-extra.test.ts
// ─── Coverage tests: adminDisputeService methods not covered elsewhere ─────────
// Targets: requestMoreInfo (lines 466–524) and the event-recording portion of
// overrideAutoResolution (lines 401–431). The full dispute resolution branches
// inside overrideAutoResolution are not exercised here to keep mocks simple.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Order repository mock ─────────────────────────────────────────────────────

const mockFindWithDisputeContext = vi.fn();
const mockFindByIdForEmail = vi.fn().mockResolvedValue(null);

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findWithDisputeContext: (...a: unknown[]) =>
      mockFindWithDisputeContext(...a),
    findByIdForEmail: (...a: unknown[]) => mockFindByIdForEmail(...a),
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
  },
}));

// ── Admin repository mock ─────────────────────────────────────────────────────

const mockFindLatestAutoResolvedEvent = vi.fn().mockResolvedValue(null);

vi.mock("@/modules/admin/admin.repository", () => ({
  adminRepository: {
    findLatestAutoResolvedEvent: (...a: unknown[]) =>
      mockFindLatestAutoResolvedEvent(...a),
    updateOrderPayouts: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Order event service mock ──────────────────────────────────────────────────

const mockRecordEvent = vi.fn();

vi.mock("@/modules/orders/order-event.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/modules/orders/order-event.service")
    >();
  return {
    ...actual,
    orderEventService: {
      ...actual.orderEventService,
      recordEvent: (...a: unknown[]) => mockRecordEvent(...a),
    },
  };
});

// ── Dispute service mock ──────────────────────────────────────────────────────

vi.mock("@/server/services/dispute/dispute.service", () => ({
  getDisputeByOrderId: vi.fn().mockResolvedValue(null),
  resolveDispute: vi.fn().mockResolvedValue(undefined),
}));

// ── Payment service mock ──────────────────────────────────────────────────────

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    capturePayment: vi.fn().mockResolvedValue(undefined),
    refundPayment: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Listing repository mock ───────────────────────────────────────────────────

vi.mock("@/modules/listings/listing.repository", () => ({
  listingRepository: {
    setStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Notification service mock ─────────────────────────────────────────────────

const mockCreateNotification = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: (...a: unknown[]) => mockCreateNotification(...a),
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────

const { adminDisputeService } =
  await import("@/modules/admin/admin-dispute.service");
const { audit } = await import("@/server/lib/audit");

// ── Shared fixture ────────────────────────────────────────────────────────────

function makeDisputedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "DISPUTED",
    stripePaymentIntentId: "pi_test123",
    totalNzd: 5000,
    listing: { id: "listing-1", title: "Vintage Camera" },
    buyer: { email: "buyer@test.com", displayName: "Buyer One" },
    seller: { email: "seller@test.com", displayName: "Seller One" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("adminDisputeService.requestMoreInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindWithDisputeContext.mockResolvedValue(makeDisputedOrder());
    mockFindLatestAutoResolvedEvent.mockResolvedValue(null);
    mockCreateNotification.mockResolvedValue(undefined);
  });

  it("throws NOT_FOUND when the order does not exist", async () => {
    mockFindWithDisputeContext.mockResolvedValue(null);

    await expect(
      adminDisputeService.requestMoreInfo(
        "order-missing",
        "buyer",
        "Please provide photos of the damaged item",
        "admin-1",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sends a notification to the buyer only when target is buyer", async () => {
    await adminDisputeService.requestMoreInfo(
      "order-1",
      "buyer",
      "Please provide proof of purchase",
      "admin-1",
    );

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "buyer-1",
        type: "ORDER_DISPUTED",
        title: "More information requested",
        orderId: "order-1",
      }),
    );
    // Seller should NOT receive a notification
    const calledUserIds = vi
      .mocked(mockCreateNotification)
      .mock.calls.map((c) => (c[0] as { userId: string }).userId);
    expect(calledUserIds).not.toContain("seller-1");
  });

  it("sends a notification to the seller only when target is seller", async () => {
    await adminDisputeService.requestMoreInfo(
      "order-1",
      "seller",
      "Please confirm shipment tracking",
      "admin-1",
    );

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "seller-1",
        type: "ORDER_DISPUTED",
      }),
    );
    const calledUserIds = vi
      .mocked(mockCreateNotification)
      .mock.calls.map((c) => (c[0] as { userId: string }).userId);
    expect(calledUserIds).not.toContain("buyer-1");
  });

  it("sends notifications to both buyer and seller when target is both", async () => {
    await adminDisputeService.requestMoreInfo(
      "order-1",
      "both",
      "We need clarification from both parties",
      "admin-1",
    );

    const calledUserIds = vi
      .mocked(mockCreateNotification)
      .mock.calls.map((c) => (c[0] as { userId: string }).userId);
    expect(calledUserIds).toContain("buyer-1");
    expect(calledUserIds).toContain("seller-1");
  });

  it("records a DISPUTE_RESPONDED order event with target and message metadata", async () => {
    await adminDisputeService.requestMoreInfo(
      "order-1",
      "buyer",
      "Please provide evidence",
      "admin-1",
    );

    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        actorId: "admin-1",
        actorRole: "ADMIN",
        metadata: expect.objectContaining({
          target: "buyer",
          message: "Please provide evidence",
        }),
      }),
    );
  });

  it("creates an audit entry for request_info with the correct metadata", async () => {
    await adminDisputeService.requestMoreInfo(
      "order-1",
      "seller",
      "Tracking number needed",
      "admin-1",
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ADMIN_ACTION",
        entityType: "Order",
        entityId: "order-1",
        metadata: expect.objectContaining({
          action: "request_info",
          target: "seller",
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("adminDisputeService.overrideAutoResolution — event recording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLatestAutoResolvedEvent.mockResolvedValue(null);
    mockFindWithDisputeContext.mockResolvedValue(makeDisputedOrder());
    mockCreateNotification.mockResolvedValue(undefined);
  });

  it("records an override event with originalDecision UNKNOWN when no auto-resolved event exists", async () => {
    mockFindLatestAutoResolvedEvent.mockResolvedValue(null);

    // Pass partial_refund WITHOUT a partialAmountCents so no inner resolution
    // method is invoked — this tests only the event-recording path.
    await adminDisputeService.overrideAutoResolution(
      "order-1",
      "partial_refund",
      "Admin review found no clear fault",
      "admin-1",
    );

    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        actorId: "admin-1",
        metadata: expect.objectContaining({
          type: "ADMIN_OVERRIDE",
          originalDecision: "UNKNOWN",
          newDecision: "partial_refund",
        }),
      }),
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ADMIN_ACTION",
        entityId: "order-1",
        metadata: expect.objectContaining({
          action: "override_auto_resolution",
          originalDecision: "UNKNOWN",
          newDecision: "partial_refund",
        }),
      }),
    );
  });

  it("includes the original auto-resolved decision in the override metadata", async () => {
    mockFindLatestAutoResolvedEvent.mockResolvedValue({
      id: "event-1",
      metadata: { decision: "AUTO_SELLER_WIN" },
    });

    await adminDisputeService.overrideAutoResolution(
      "order-1",
      "partial_refund",
      "Reconsidering the auto-resolution outcome",
      "admin-1",
    );

    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          originalDecision: "AUTO_SELLER_WIN",
          newDecision: "partial_refund",
        }),
      }),
    );
  });
});
