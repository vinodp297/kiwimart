// src/test/pickupWorker-otpExpired.test.ts
// ─── Tests: handleOtpExpired (buyer no-show) ─────────────────────────────────
// Verifies that payment capture is attempted BEFORE completing the order,
// and that capture failure routes to DISPUTED instead of COMPLETED.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import db from "@/lib/db";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { paymentService } from "@/modules/payments/payment.service";
import { createNotification } from "@/modules/notifications/notification.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { audit } from "@/server/lib/audit";

// ─── vi.mock declarations (hoisted) ──────────────────────────────────────────

vi.mock("server-only", () => ({}));

vi.mock("@/lib/queue", () => ({
  payoutQueue: { add: vi.fn() },
  emailQueue: { add: vi.fn() },
  pickupQueue: {
    add: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  getQueueConnection: vi.fn(),
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    capturePayment: vi.fn().mockResolvedValue(undefined),
    refundPayment: vi.fn().mockResolvedValue({ id: "re_mock" }),
  },
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    DISPUTE_OPENED: "DISPUTE_OPENED",
  },
  ACTOR_ROLES: {
    BUYER: "BUYER",
    SELLER: "SELLER",
    SYSTEM: "SYSTEM",
  },
}));

vi.mock("@/server/lib/audit", () => ({
  audit: vi.fn(),
}));

vi.mock("@/server/email", () => ({
  sendDisputeResolvedEmail: vi.fn().mockResolvedValue(undefined),
}));

// ─── Patch db with models not in setup.ts ────────────────────────────────────

const mockTrustMetrics = {
  upsert: vi.fn().mockResolvedValue({}),
};
(db as unknown as Record<string, unknown>).trustMetrics = mockTrustMetrics;

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeOtpOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "AWAITING_PICKUP",
    pickupStatus: "OTP_INITIATED",
    totalNzd: 5000,
    stripePaymentIntentId: "pi_test_abc",
    listingId: "listing-1",
    listing: { title: "Test Widget" },
    ...overrides,
  };
}

// ─── Lazy import (after mocks are in place) ──────────────────────────────────

let handleOtpExpired: (typeof import("@/server/workers/pickupWorker"))["handleOtpExpired"];

// ─────────────────────────────────────────────────────────────────────────────

describe("pickupWorker — handleOtpExpired (buyer no-show)", () => {
  beforeAll(async () => {
    const mod = await import("@/server/workers/pickupWorker");
    handleOtpExpired = mod.handleOtpExpired;
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-apply implementations cleared by clearAllMocks
    vi.mocked(transitionOrder).mockResolvedValue(undefined as never);
    vi.mocked(paymentService.capturePayment).mockResolvedValue(undefined);
    vi.mocked(createNotification).mockResolvedValue(undefined);
    vi.mocked(db.payout.upsert).mockResolvedValue({} as never);
    vi.mocked(db.listing.update).mockResolvedValue({} as never);
    mockTrustMetrics.upsert.mockResolvedValue({});

    // $transaction: call callback synchronously with db as the tx
    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return (fn as (tx: typeof db) => Promise<unknown>)(db);
      }
      return [];
    });
  });

  // ── ONLINE payment, capture succeeds ──────────────────────────────────────

  it("captures payment BEFORE transitioning to COMPLETED for online orders", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOtpOrder() as never);

    await handleOtpExpired("order-1");

    // capturePayment must be called
    expect(paymentService.capturePayment).toHaveBeenCalledWith({
      paymentIntentId: "pi_test_abc",
      orderId: "order-1",
    });

    // Order transitioned to COMPLETED (not DISPUTED)
    expect(transitionOrder).toHaveBeenCalledWith(
      "order-1",
      "COMPLETED",
      expect.objectContaining({ pickupStatus: "BUYER_NO_SHOW" }),
      expect.objectContaining({ fromStatus: "AWAITING_PICKUP" }),
    );

    // Payout created
    expect(db.payout.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: "order-1" },
        create: expect.objectContaining({
          status: "PROCESSING",
          amountNzd: 5000,
        }),
      }),
    );

    // Event recorded as COMPLETED
    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.COMPLETED,
        actorRole: ACTOR_ROLES.SYSTEM,
      }),
    );
  });

  // ── ONLINE payment, capture FAILS ─────────────────────────────────────────

  it("transitions to DISPUTED when capture fails for online orders", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOtpOrder() as never);
    vi.mocked(paymentService.capturePayment).mockRejectedValue(
      new Error("Payment authorization has expired"),
    );

    // Should NOT throw — job completes gracefully
    await handleOtpExpired("order-1");

    // capturePayment was attempted
    expect(paymentService.capturePayment).toHaveBeenCalledWith({
      paymentIntentId: "pi_test_abc",
      orderId: "order-1",
    });

    // Order transitioned to DISPUTED (not COMPLETED)
    expect(transitionOrder).toHaveBeenCalledWith(
      "order-1",
      "DISPUTED",
      expect.objectContaining({
        pickupStatus: "BUYER_NO_SHOW",
        otpCodeHash: null,
        otpExpiresAt: null,
      }),
      expect.objectContaining({ fromStatus: "AWAITING_PICKUP" }),
    );

    // Payout NOT created (since order is not completed)
    expect(db.payout.upsert).not.toHaveBeenCalled();

    // Event recorded as DISPUTE_OPENED
    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.DISPUTE_OPENED,
        summary: expect.stringContaining("requires manual review"),
        metadata: expect.objectContaining({
          trigger: "BUYER_NO_SHOW_CAPTURE_FAILED",
        }),
      }),
    );

    // Audit trail recorded
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ORDER_STATUS_CHANGED",
        metadata: expect.objectContaining({
          trigger: "BUYER_NO_SHOW_CAPTURE_FAILED",
          newStatus: "DISPUTED",
        }),
      }),
    );
  });

  // ── CASH order (no stripePaymentIntentId) ─────────────────────────────────

  it("completes without calling capturePayment for cash pickup orders", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      makeOtpOrder({ stripePaymentIntentId: null }) as never,
    );

    await handleOtpExpired("order-1");

    // capturePayment should never be called
    expect(paymentService.capturePayment).not.toHaveBeenCalled();

    // Order still transitions to COMPLETED
    expect(transitionOrder).toHaveBeenCalledWith(
      "order-1",
      "COMPLETED",
      expect.objectContaining({ pickupStatus: "BUYER_NO_SHOW" }),
      expect.objectContaining({ fromStatus: "AWAITING_PICKUP" }),
    );

    // Payout created
    expect(db.payout.upsert).toHaveBeenCalled();
  });

  // ── Idempotency: already processed ────────────────────────────────────────

  it("skips processing when pickupStatus is not OTP_INITIATED", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      makeOtpOrder({ pickupStatus: "BUYER_NO_SHOW" }) as never,
    );

    await handleOtpExpired("order-1");

    expect(paymentService.capturePayment).not.toHaveBeenCalled();
    expect(transitionOrder).not.toHaveBeenCalled();
    expect(db.payout.upsert).not.toHaveBeenCalled();
  });

  // ── Missing order ─────────────────────────────────────────────────────────

  it("returns silently when order does not exist", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(null as never);

    await handleOtpExpired("order-nonexistent");

    expect(paymentService.capturePayment).not.toHaveBeenCalled();
    expect(transitionOrder).not.toHaveBeenCalled();
  });
});
