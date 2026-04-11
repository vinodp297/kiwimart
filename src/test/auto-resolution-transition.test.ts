// src/test/auto-resolution-transition.test.ts
// ─── Tests: E-3 fix — post-Stripe DB transition errors logged + rethrown ──────
// Verifies that when a DB transition fails AFTER Stripe money has moved:
//   1. AUTO_REFUND: transition failure logs ERROR with requiresManualReconciliation
//   2. AUTO_REFUND: transition failure is rethrown (not silently swallowed)
//   3. AUTO_DISMISS: transition failure logs ERROR with requiresManualReconciliation
//   4. AUTO_DISMISS: transition failure is rethrown (not silently swallowed)

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockFindForAutoResolutionExecute,
  mockGetDisputeByOrderId,
  mockRefundPayment,
  mockCapturePayment,
  mockTransitionOrder,
  mockTransaction,
  mockLoggerError,
  mockLoggerInfo,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockFindForAutoResolutionExecute: vi.fn(),
  mockGetDisputeByOrderId: vi.fn(),
  mockRefundPayment: vi.fn(),
  mockCapturePayment: vi.fn(),
  mockTransitionOrder: vi.fn(),
  mockTransaction: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findForAutoResolutionExecute: (...a: unknown[]) =>
      mockFindForAutoResolutionExecute(...a),
    $transaction: (...a: unknown[]) => mockTransaction(...a),
    markPayoutsProcessing: vi.fn().mockResolvedValue(undefined),
    markListingSold: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/server/services/dispute/dispute.service", () => ({
  getDisputeByOrderId: (...a: unknown[]) => mockGetDisputeByOrderId(...a),
  resolveDispute: vi.fn().mockResolvedValue(undefined),
  setAutoResolving: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/lib/distributedLock", () => ({
  withLock: vi
    .fn()
    .mockImplementation(async (_key: string, fn: () => Promise<unknown>) =>
      fn(),
    ),
  withLockAndHeartbeat: vi
    .fn()
    .mockImplementation(async (_key: string, fn: () => Promise<unknown>) =>
      fn(),
    ),
  acquireLock: vi.fn().mockResolvedValue("mock-lock"),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    refundPayment: (...a: unknown[]) => mockRefundPayment(...a),
    capturePayment: (...a: unknown[]) => mockCapturePayment(...a),
  },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: (...a: unknown[]) => mockTransitionOrder(...a),
}));

vi.mock("@/server/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/trust/trust-metrics.service", () => ({
  trustMetricsService: {
    updateBuyerMetricsOnDispute: vi.fn().mockResolvedValue(undefined),
    updateSellerMetricsOnDispute: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/listings/listing.repository", () => ({
  listingRepository: {
    restoreFromSold: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findManyEmailContactsByIds: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/shared/logger", () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn().mockResolvedValue(undefined) },
  ORDER_EVENT_TYPES: {
    REFUNDED: "REFUNDED",
    DISPUTE_RESOLVED: "DISPUTE_RESOLVED",
    DISPUTE_RESPONDED: "DISPUTE_RESPONDED",
    CANCELLED: "CANCELLED",
  },
  ACTOR_ROLES: { SYSTEM: "SYSTEM" },
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: vi.fn(),
}));

vi.mock("@/lib/currency", () => ({
  formatCentsAsNzd: (c: number) => `$${(c / 100).toFixed(2)}`,
}));

vi.mock("@/server/email", () => ({
  sendDisputeResolvedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("server-only", () => ({}));

// ── Import service after mocks ─────────────────────────────────────────────────

import { AutoResolutionService } from "@/modules/disputes/auto-resolution.service";

// ── Test data ─────────────────────────────────────────────────────────────────

const mockOrder = {
  id: "ord-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  status: "DISPUTED",
  stripePaymentIntentId: "pi_test_123",
  totalNzd: 5000,
  listing: { id: "lst-1", title: "Test Item" },
};

const mockDispute = {
  id: "disp-1",
  orderId: "ord-1",
  status: "AUTO_RESOLVING",
};

const refundEvaluation = {
  decision: "AUTO_REFUND" as const,
  score: 75,
  canAutoResolve: true,
  coolingPeriodHours: 24,
  factors: [],
  recommendation: "Full refund to buyer",
};

const dismissEvaluation = {
  decision: "AUTO_DISMISS" as const,
  score: 20,
  canAutoResolve: true,
  coolingPeriodHours: 24,
  factors: [],
  recommendation: "Dismiss in seller favour",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AutoResolutionService.executeDecision — post-Stripe DB transition error handling", () => {
  let service: AutoResolutionService;

  beforeEach(() => {
    vi.clearAllMocks();

    service = new AutoResolutionService();

    mockFindForAutoResolutionExecute.mockResolvedValue(mockOrder);
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute);
    mockRefundPayment.mockResolvedValue(undefined);
    mockCapturePayment.mockResolvedValue(undefined);
    mockTransitionOrder.mockResolvedValue(undefined);

    // Default: transaction executes the callback
    mockTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  describe("AUTO_REFUND path", () => {
    it("logs ERROR with requiresManualReconciliation when DB transition fails after Stripe refund", async () => {
      // Stripe refund succeeds
      mockRefundPayment.mockResolvedValue(undefined);
      // DB transaction fails — money moved but DB not updated
      const dbError = new Error("DB connection timeout");
      mockTransaction.mockRejectedValue(dbError);

      await expect(
        service.executeDecision("ord-1", refundEvaluation),
      ).rejects.toThrow("DB connection timeout");

      expect(mockLoggerError).toHaveBeenCalledWith(
        "auto-resolution.transition_failed",
        expect.objectContaining({
          orderId: "ord-1",
          target: "REFUNDED",
          requiresManualReconciliation: true,
        }),
      );
    });

    it("rethrows the transition error — does NOT swallow it silently", async () => {
      mockRefundPayment.mockResolvedValue(undefined);
      const dbError = new Error("Prisma: write conflict");
      mockTransaction.mockRejectedValue(dbError);

      // Must reject — the error must propagate so BullMQ can DLQ it
      await expect(
        service.executeDecision("ord-1", refundEvaluation),
      ).rejects.toThrow("Prisma: write conflict");
    });

    it("does NOT log auto-resolution.transition_failed when refund itself fails (different path)", async () => {
      // Stripe refund fails — should NOT trigger the transition_failed log
      mockRefundPayment.mockRejectedValue(new Error("Stripe unavailable"));

      await expect(
        service.executeDecision("ord-1", refundEvaluation),
      ).resolves.toBeUndefined(); // refund failure returns early, doesn't throw

      // transition_failed must NOT be logged — it was the Stripe step that failed
      expect(mockLoggerError).not.toHaveBeenCalledWith(
        "auto-resolution.transition_failed",
        expect.anything(),
      );
    });
  });

  describe("AUTO_DISMISS path", () => {
    it("logs ERROR with requiresManualReconciliation when DB transition fails after Stripe capture", async () => {
      // Stripe capture succeeds
      mockCapturePayment.mockResolvedValue(undefined);
      // DB transaction fails — money moved but DB not updated
      const dbError = new Error("Deadlock detected");
      mockTransaction.mockRejectedValue(dbError);

      await expect(
        service.executeDecision("ord-1", dismissEvaluation),
      ).rejects.toThrow("Deadlock detected");

      expect(mockLoggerError).toHaveBeenCalledWith(
        "auto-resolution.dismiss_failed",
        expect.objectContaining({
          orderId: "ord-1",
          requiresManualReconciliation: true,
        }),
      );
    });

    it("rethrows the transition error — does NOT swallow it silently", async () => {
      mockCapturePayment.mockResolvedValue(undefined);
      const dbError = new Error("Unique constraint violation");
      mockTransaction.mockRejectedValue(dbError);

      // Must reject — the error must propagate so BullMQ can DLQ it
      await expect(
        service.executeDecision("ord-1", dismissEvaluation),
      ).rejects.toThrow("Unique constraint violation");
    });
  });
});
