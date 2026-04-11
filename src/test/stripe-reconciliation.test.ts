// src/test/stripe-reconciliation.test.ts
// ─── Tests: Stripe reconciliation auto-fix ───────────────────────────────────
//
// Verifies that runStripeReconciliation():
//   1. Transitions AWAITING_PAYMENT → PAYMENT_HELD when PI is requires_capture
//   2. Transitions AWAITING_PAYMENT → PAYMENT_HELD when PI is succeeded
//   3. Transitions AWAITING_PAYMENT → CANCELLED and releases listing when PI is canceled
//   4. Logs stale PAYMENT_HELD orders as requiring manual review
//   5. Skips processing when the distributed lock is held

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { createMockLogger } from "./fixtures";

vi.mock("server-only", () => ({}));

// ── Mock: distributed lock ───────────────────────────────────────────────────

const mockAcquireLock = vi.fn();
const mockReleaseLock = vi.fn();

vi.mock("@/server/lib/distributedLock", () => ({
  acquireLock: (...a: unknown[]) => mockAcquireLock(...a),
  releaseLock: (...a: unknown[]) => mockReleaseLock(...a),
}));

// ── Mock: Stripe ─────────────────────────────────────────────────────────────

const mockRetrievePI = vi.fn();

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    paymentIntents: {
      retrieve: (...a: unknown[]) => mockRetrievePI(...a),
    },
  },
}));

// ── Mock: logger ─────────────────────────────────────────────────────────────

vi.mock("@/shared/logger", () => ({
  logger: createMockLogger(),
}));

// ── Mock: request context ─────────────────────────────────────────────────────

vi.mock("@/lib/request-context", () => ({
  runWithRequestContext: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  getRequestContext: () => null,
}));

// ── Mock: orderRepository ────────────────────────────────────────────────────

const mockFindAwaiting = vi.fn();
const mockFindHeld = vi.fn();
const mockReleaseListing = vi.fn();

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findAwaitingPaymentWithPiOlderThan: (...a: unknown[]) =>
      mockFindAwaiting(...a),
    findPaymentHeldWithPiOlderThan: (...a: unknown[]) => mockFindHeld(...a),
    releaseListing: (...a: unknown[]) => mockReleaseListing(...a),
  },
}));

// ── Mock: transitionOrder ────────────────────────────────────────────────────

const mockTransitionOrder = vi.fn();

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: (...a: unknown[]) => mockTransitionOrder(...a),
}));

import { runStripeReconciliation } from "@/server/jobs/stripeReconciliation";
import { logger } from "@/shared/logger";

const AWAITING_ORDER = {
  id: "order-1",
  stripePaymentIntentId: "pi_test_123",
  listingId: "listing-1",
};

const HELD_ORDER = {
  id: "order-2",
  stripePaymentIntentId: "pi_test_456",
};

describe("Stripe Reconciliation — auto-fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquireLock.mockResolvedValue("lock-token");
    mockReleaseLock.mockResolvedValue(undefined);
    mockFindAwaiting.mockResolvedValue([]);
    mockFindHeld.mockResolvedValue([]);
    mockTransitionOrder.mockResolvedValue(undefined);
    mockReleaseListing.mockResolvedValue({ count: 1 });
  });

  it("transitions AWAITING_PAYMENT → PAYMENT_HELD when PI is requires_capture", async () => {
    mockFindAwaiting.mockResolvedValue([AWAITING_ORDER]);
    mockRetrievePI.mockResolvedValue({ status: "requires_capture" });

    await runStripeReconciliation();

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "order-1",
      "PAYMENT_HELD",
      {},
      { fromStatus: "AWAITING_PAYMENT" },
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "stripe.reconciliation.fixed_awaiting_to_payment_held",
      expect.objectContaining({
        orderId: "order-1",
        piStatus: "requires_capture",
      }),
    );
  });

  it("transitions AWAITING_PAYMENT → PAYMENT_HELD when PI is succeeded", async () => {
    mockFindAwaiting.mockResolvedValue([AWAITING_ORDER]);
    mockRetrievePI.mockResolvedValue({ status: "succeeded" });

    await runStripeReconciliation();

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "order-1",
      "PAYMENT_HELD",
      {},
      { fromStatus: "AWAITING_PAYMENT" },
    );
  });

  it("transitions AWAITING_PAYMENT → CANCELLED and releases listing when PI is canceled", async () => {
    mockFindAwaiting.mockResolvedValue([AWAITING_ORDER]);
    mockRetrievePI.mockResolvedValue({ status: "canceled" });

    await runStripeReconciliation();

    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "order-1",
      "CANCELLED",
      { cancelledAt: expect.any(Date) },
      { fromStatus: "AWAITING_PAYMENT" },
    );
    expect(mockReleaseListing).toHaveBeenCalledWith("listing-1");
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "stripe.reconciliation.fixed_awaiting_to_cancelled",
      expect.objectContaining({ orderId: "order-1", piStatus: "canceled" }),
    );
  });

  it("logs stale PAYMENT_HELD orders as requiring manual review", async () => {
    mockFindHeld.mockResolvedValue([HELD_ORDER]);

    await runStripeReconciliation();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "stripe.reconciliation.stale_payment_held",
      expect.objectContaining({
        orderId: "order-2",
        requiresManualReview: true,
      }),
    );
    // Stale held orders must NOT be auto-transitioned — manual review only
    expect(mockTransitionOrder).not.toHaveBeenCalled();
  });

  it("skips all processing when the distributed lock is held by another instance", async () => {
    mockAcquireLock.mockResolvedValue(null); // lock unavailable

    await runStripeReconciliation();

    expect(mockFindAwaiting).not.toHaveBeenCalled();
    expect(mockFindHeld).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "stripe_reconciliation.skipped_lock_held",
      expect.any(Object),
    );
  });
});
