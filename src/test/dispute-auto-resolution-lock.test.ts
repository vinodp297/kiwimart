// src/test/dispute-auto-resolution-lock.test.ts
// ─── Fix 3 tests: distributed lock on dispute auto-resolution ────────────────
// Verifies that executeDecision acquires a lock BEFORE any state mutation,
// and re-verifies dispute status inside the lock before proceeding.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── Named mock functions (top-level so vi.mock hoisting can reference them) ───
const mockFindForAutoResolutionExecute = vi.fn();
const mockGetDisputeByOrderId = vi.fn();
const mockRefundPayment = vi.fn().mockResolvedValue(undefined);
const mockCapturePayment = vi.fn().mockResolvedValue(undefined);
const mockTransitionOrder = vi.fn().mockResolvedValue(undefined);
const mockWithLock = vi.fn(
  async (key: string, fn: () => Promise<unknown>, opts?: object) => {
    lockKeysUsed.push(key);
    lockOptionsList.push((opts ?? {}) as { ttlSeconds?: number });
    return fn();
  },
);

// Arrays to capture lock args across the withLock mock
const lockKeysUsed: string[] = [];
const lockOptionsList: Array<{ ttlSeconds?: number }> = [];

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findForAutoResolutionExecute: (...a: unknown[]) =>
      mockFindForAutoResolutionExecute(...a),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
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
  withLock: (...a: unknown[]) => mockWithLock(...(a as never)),
  withLockAndHeartbeat: (...a: unknown[]) => mockWithLock(...(a as never)),
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

vi.mock("@/modules/users/user.repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/users/user.repository")>();
  return {
    ...actual,
    userRepository: {
      ...(actual.userRepository as object),
      findManyEmailContactsByIds: vi.fn().mockResolvedValue([]),
    },
  };
});

// ── Test data ─────────────────────────────────────────────────────────────────

const mockOrder = {
  id: "ord-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  status: "DISPUTED",
  stripePaymentIntentId: "pi_test",
  totalNzd: 5000,
  listing: { id: "lst-1", title: "Test Item" },
};

const mockDisputeAutoResolving = {
  id: "disp-1",
  orderId: "ord-1",
  status: "AUTO_RESOLVING",
};

const baseEvaluation = {
  decision: "AUTO_REFUND" as const,
  score: 70,
  canAutoResolve: true,
  coolingPeriodHours: 24,
  factors: [],
  recommendation: "Full refund",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Fix 3 — dispute auto-resolution distributed lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockKeysUsed.length = 0;
    lockOptionsList.length = 0;

    // Reset withLock to default pass-through
    mockWithLock.mockImplementation(
      async (key: string, fn: () => Promise<unknown>, opts?: object) => {
        lockKeysUsed.push(key);
        lockOptionsList.push((opts ?? {}) as { ttlSeconds?: number });
        return fn();
      },
    );

    // Default successful mocks
    mockFindForAutoResolutionExecute.mockResolvedValue(mockOrder);
    mockGetDisputeByOrderId.mockResolvedValue(mockDisputeAutoResolving);
    mockRefundPayment.mockResolvedValue(undefined);
    mockTransitionOrder.mockResolvedValue(undefined);
  });

  it("lock key is dispute:{disputeId} format when dispute exists", async () => {
    const { autoResolutionService } =
      await import("@/modules/disputes/auto-resolution.service");
    await autoResolutionService
      .executeDecision("ord-1", baseEvaluation)
      .catch(() => {});

    expect(lockKeysUsed[0]).toBe("dispute:disp-1");
  });

  it("lock ttlSeconds is 120", async () => {
    const { autoResolutionService } =
      await import("@/modules/disputes/auto-resolution.service");
    await autoResolutionService
      .executeDecision("ord-1", baseEvaluation)
      .catch(() => {});

    expect(lockOptionsList[0]?.ttlSeconds).toBe(120);
  });

  it("skips execution when dispute status is not AUTO_RESOLVING inside lock", async () => {
    // Before-lock: AUTO_RESOLVING (provides lock key)
    // Inside-lock re-fetch: RESOLVED (admin resolved it first)
    mockGetDisputeByOrderId
      .mockResolvedValueOnce(mockDisputeAutoResolving) // before lock
      .mockResolvedValueOnce({
        ...mockDisputeAutoResolving,
        status: "RESOLVED",
      }); // inside lock

    const { logger } = await import("@/shared/logger");
    const { autoResolutionService } =
      await import("@/modules/disputes/auto-resolution.service");
    await autoResolutionService.executeDecision("ord-1", baseEvaluation);

    // Refund must NOT have been called — execution was skipped
    expect(mockRefundPayment).not.toHaveBeenCalled();

    // Logger recorded the skip
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "dispute.auto_resolve.skipped",
      expect.objectContaining({
        disputeId: "disp-1",
        currentStatus: "RESOLVED",
        orderId: "ord-1",
      }),
    );
  });

  it("lock is acquired BEFORE any payment or state mutation", async () => {
    const callOrder: string[] = [];

    mockWithLock.mockImplementationOnce(
      async (key: string, fn: () => Promise<unknown>, opts?: object) => {
        lockKeysUsed.push(key);
        lockOptionsList.push((opts ?? {}) as { ttlSeconds?: number });
        callOrder.push("lock_acquired");
        return fn();
      },
    );

    mockRefundPayment.mockImplementationOnce(async () => {
      callOrder.push("refund_called");
    });

    const { autoResolutionService } =
      await import("@/modules/disputes/auto-resolution.service");
    await autoResolutionService
      .executeDecision("ord-1", baseEvaluation)
      .catch(() => {});

    expect(callOrder.indexOf("lock_acquired")).toBeLessThan(
      callOrder.indexOf("refund_called"),
    );
  });
});
