// src/test/testing-sprint-d.test.ts
// ─── Testing Sprint D — Branch coverage for critical modules ────────────────
//
// Targets branches in critical payment/order/auth/dispute paths that existing
// tests do not exercise. Every test here drives a REAL branch decision — no
// argument-matching smoke tests, no stubs of the code under test.
//
// Modules covered:
//   • src/server/lib/requireUser.ts              — session cleanup catch
//   • src/modules/users/auth.service.ts          — Turnstile + email queue catches
//   • src/modules/orders/order.transitions.ts    — optimistic lock logger paths
//   • src/modules/orders/order-cancel.service.ts — status gating branches
//   • src/modules/disputes/auto-resolution.service.ts — fraud + factor edges

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./setup";

import db from "@/lib/db";

// ═══════════════════════════════════════════════════════════════════════════
// requireUser — session cleanup catch branch (line 61-66 in requireUser.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("Fix 1.1 — requireUser: session cleanup catch branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still throws banned() when db.session.deleteMany rejects", async () => {
    const { requireUser } = await import("@/server/lib/requireUser");
    const { auth } = await import("@/lib/auth");
    const { logger } = await import("@/shared/logger");

    vi.mocked(auth).mockResolvedValue({
      user: { id: "banned-1" },
    } as never);

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "banned-1",
      email: "banned@kiwi.test",
      isAdmin: false,
      isBanned: true,
      isSellerEnabled: false,
      isStripeOnboarded: false,
    } as never);

    // Force the cleanup to fail — requireUser MUST still throw banned.
    vi.mocked(db.session.deleteMany).mockRejectedValue(
      new Error("redis/db hiccup"),
    );

    await expect(requireUser()).rejects.toThrow(/suspended/i);

    // The catch branch now routes through logger.error, not console.error.
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "require_user.session_cleanup_failed",
      expect.objectContaining({ userId: "banned-1" }),
    );
  });

  it("logs the error message string (not the raw Error object)", async () => {
    const { requireUser } = await import("@/server/lib/requireUser");
    const { auth } = await import("@/lib/auth");
    const { logger } = await import("@/shared/logger");

    vi.mocked(auth).mockResolvedValue({
      user: { id: "banned-2" },
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "banned-2",
      email: "b2@kiwi.test",
      isAdmin: false,
      isBanned: true,
      isSellerEnabled: false,
      isStripeOnboarded: false,
    } as never);

    // Non-Error rejection exercises the `String(err)` branch.
    vi.mocked(db.session.deleteMany).mockRejectedValue("string failure");

    await expect(requireUser()).rejects.toThrow(/suspended/i);

    // logger.error must have been called and the error string captured.
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "require_user.session_cleanup_failed",
      expect.objectContaining({ error: "string failure" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// auth.service — Turnstile production branches + email queue catch
// ═══════════════════════════════════════════════════════════════════════════

// Mock userRepository + turnstile module-level. These mocks live outside any
// describe so they apply to the fresh dynamic import below.
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    existsByEmail: vi.fn().mockResolvedValue(false),
    existsByUsername: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({
      id: "new-user-1",
      email: "new@kiwi.test",
      displayName: "New User",
    }),
    findByEmail: vi.fn(),
    invalidatePendingResetTokens: vi.fn().mockResolvedValue(undefined),
    createResetToken: vi.fn().mockResolvedValue(undefined),
    findResetTokenWithUser: vi.fn().mockResolvedValue(null),
    findEmailVerified: vi.fn().mockResolvedValue({ emailVerified: new Date() }),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const { default: dbClient } = await import("@/lib/db");
        return fn(dbClient);
      }),
  },
}));

vi.mock("@/server/lib/turnstile", () => ({
  verifyTurnstile: vi.fn(),
}));

describe("Fix 1.2 — auth.service.register: Turnstile production branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fresh-mount production env so the Turnstile branch is exercised.
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when turnstileToken is missing in production", async () => {
    const { authService } = await import("@/modules/users/auth.service");
    const { userRepository } = await import("@/modules/users/user.repository");

    await expect(
      authService.register(
        {
          email: "prod1@kiwi.test",
          firstName: "Prod",
          lastName: "User",
          password: "SecurePass123!",
          hasMarketingConsent: false,
          // turnstileToken intentionally omitted
        } as never,
        "127.0.0.1",
      ),
    ).rejects.toThrow(/verification required/i);

    // Fail-closed: no user creation attempted.
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it("throws when Turnstile verification returns false in production", async () => {
    const { authService } = await import("@/modules/users/auth.service");
    const { verifyTurnstile } = await import("@/server/lib/turnstile");
    const { userRepository } = await import("@/modules/users/user.repository");

    vi.mocked(verifyTurnstile).mockResolvedValue(false);

    await expect(
      authService.register(
        {
          email: "prod2@kiwi.test",
          firstName: "Prod",
          lastName: "User",
          password: "SecurePass123!",
          hasMarketingConsent: false,
          turnstileToken: "tampered-token",
        } as never,
        "127.0.0.1",
      ),
    ).rejects.toThrow(/verification failed/i);

    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it("skips Turnstile entirely in non-production and registers", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const { authService } = await import("@/modules/users/auth.service");
    const { verifyTurnstile } = await import("@/server/lib/turnstile");
    const { userRepository } = await import("@/modules/users/user.repository");

    const result = await authService.register(
      {
        email: "dev@kiwi.test",
        firstName: "Dev",
        lastName: "User",
        password: "SecurePass123!",
        hasMarketingConsent: false,
      } as never,
      "127.0.0.1",
    );

    expect(result.userId).toBe("new-user-1");
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(userRepository.create).toHaveBeenCalledTimes(1);
  });
});

describe("Fix 1.3 — auth.service: email queue .catch branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("register: propagates welcome-email enqueue failure — no silent catch", async () => {
    const { authService } = await import("@/modules/users/auth.service");
    const { enqueueEmail } = await import("@/lib/email-queue");

    vi.mocked(enqueueEmail).mockRejectedValueOnce(new Error("queue down"));

    await expect(
      authService.register(
        {
          email: "q1@kiwi.test",
          firstName: "Queue",
          lastName: "Down",
          password: "SecurePass123!",
          hasMarketingConsent: false,
        } as never,
        "127.0.0.1",
      ),
    ).rejects.toThrow("queue down");

    expect(enqueueEmail).toHaveBeenCalledTimes(1);
  });

  it("requestPasswordReset: silent return when user not found (enumeration guard)", async () => {
    const { authService } = await import("@/modules/users/auth.service");
    const { userRepository } = await import("@/modules/users/user.repository");
    const { enqueueEmail } = await import("@/lib/email-queue");

    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);

    await expect(
      authService.requestPasswordReset("ghost@kiwi.test", "127.0.0.1", null),
    ).resolves.toBeUndefined();

    expect(userRepository.createResetToken).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it("requestPasswordReset: propagates email queue failure — no silent catch", async () => {
    const { authService } = await import("@/modules/users/auth.service");
    const { userRepository } = await import("@/modules/users/user.repository");
    const { enqueueEmail } = await import("@/lib/email-queue");

    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "u-reset-1",
      email: "reset@kiwi.test",
      displayName: "Reset User",
    } as never);
    vi.mocked(enqueueEmail).mockRejectedValueOnce(new Error("smtp down"));

    await expect(
      authService.requestPasswordReset("reset@kiwi.test", "127.0.0.1", null),
    ).rejects.toThrow("smtp down");

    // Token WAS created before the email attempt failed.
    expect(userRepository.createResetToken).toHaveBeenCalledTimes(1);
  });
});

describe("Fix 1.4 — auth.service.resetPassword: weak password branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws with schema message when password fails strength check", async () => {
    const { authService } = await import("@/modules/users/auth.service");
    const { userRepository } = await import("@/modules/users/user.repository");

    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue({
      id: "tok-1",
      userId: "u-1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: { id: "u-1", email: "u@kiwi.test", displayName: "U" },
    } as never);

    await expect(
      authService.resetPassword(
        { token: "raw", password: "weak" }, // fails min 12 chars
        "127.0.0.1",
      ),
    ).rejects.toThrow();

    // Transaction must not have run — weak password aborts before the tx.
    expect(userRepository.transaction).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// order.transitions — logger paths on optimistic lock and success
// ═══════════════════════════════════════════════════════════════════════════

// Share one mock for the whole describe so the second test doesn't pick up
// the first test's stale updateStatusOptimistic implementation.
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findByIdForTransition: vi.fn(),
    updateStatusOptimistic: vi.fn().mockResolvedValue({ count: 1 }),
    createEvent: vi.fn().mockResolvedValue({ id: "evt-1" }),
    findEventsByOrderId: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    findByIdForCancel: vi.fn(),
    findByIdForEmail: vi.fn(),
    reactivateListingInTx: vi.fn(),
    findForAutoResolutionEvaluate: vi.fn(),
    findForAutoResolutionExecute: vi.fn(),
    findDispatchEvent: vi.fn().mockResolvedValue(null),
    findDeliveryOkEvent: vi.fn().mockResolvedValue(null),
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
  },
}));

// Support repositories used by auto-resolution scoring.
vi.mock("@/modules/orders/interaction.repository", () => ({
  interactionRepository: {
    countPriorBuyerInteractions: vi.fn().mockResolvedValue(0),
    findRejectedByResponder: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/modules/listings/listing.repository", () => ({
  listingRepository: {
    restoreFromSold: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("Fix 1.5 — order.transitions: logger paths", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { orderRepository } =
      await import("@/modules/orders/order.repository");
    // Reset to a success-count default each test.
    vi.mocked(orderRepository.updateStatusOptimistic).mockResolvedValue({
      count: 1,
    } as never);
  });

  it("logs warn on optimistic lock failure (count=0)", async () => {
    const { orderRepository } =
      await import("@/modules/orders/order.repository");
    vi.mocked(orderRepository.updateStatusOptimistic).mockResolvedValue({
      count: 0,
    } as never);

    const { transitionOrder } =
      await import("@/modules/orders/order.transitions");
    const { logger } = await import("@/shared/logger");

    await expect(
      transitionOrder(
        "order-lock",
        "DISPATCHED",
        {},
        { fromStatus: "PAYMENT_HELD" },
      ),
    ).rejects.toThrow(/concurrent modification/);

    expect(logger.warn).toHaveBeenCalledWith(
      "order.transition.optimistic_lock_failed",
      expect.objectContaining({
        orderId: "order-lock",
        expectedStatus: "PAYMENT_HELD",
        targetStatus: "DISPATCHED",
      }),
    );
  });

  it("logs info with from/to on successful transition", async () => {
    const { transitionOrder } =
      await import("@/modules/orders/order.transitions");
    const { logger } = await import("@/shared/logger");

    await transitionOrder(
      "order-ok",
      "DISPATCHED",
      {},
      { fromStatus: "PAYMENT_HELD" },
    );

    expect(logger.info).toHaveBeenCalledWith(
      "order.transition.applied",
      expect.objectContaining({
        orderId: "order-ok",
        from: "PAYMENT_HELD",
        to: "DISPATCHED",
      }),
    );
  });

  it("attaches code: 'P2025' on concurrent modification error", async () => {
    const { orderRepository } =
      await import("@/modules/orders/order.repository");
    vi.mocked(orderRepository.updateStatusOptimistic).mockResolvedValue({
      count: 0,
    } as never);

    const { transitionOrder } =
      await import("@/modules/orders/order.transitions");

    try {
      await transitionOrder(
        "order-p2025",
        "CANCELLED",
        {},
        { fromStatus: "PAYMENT_HELD" },
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("P2025");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// order-cancel.service — status gating branches
// ═══════════════════════════════════════════════════════════════════════════

describe("Fix 1.6 — order-cancel: status gating branches", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { orderRepository } =
      await import("@/modules/orders/order.repository");
    vi.mocked(orderRepository.updateStatusOptimistic).mockResolvedValue({
      count: 1,
    } as never);
  });

  it("throws ORDER_WRONG_STATE when cancelling a DISPATCHED order", async () => {
    const { cancelOrder } =
      await import("@/modules/orders/order-cancel.service");
    const { orderRepository } =
      await import("@/modules/orders/order.repository");

    vi.mocked(orderRepository.findByIdForCancel).mockResolvedValue({
      id: "order-dispatched",
      status: "DISPATCHED",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      createdAt: new Date(),
      stripePaymentIntentId: null,
      listingId: "list-1",
      totalNzd: 5000,
    } as never);

    await expect(cancelOrder("order-dispatched", "buyer-1")).rejects.toThrow(
      /cannot be cancelled|dispute/i,
    );

    // The CANCELLED transition must never have been attempted for a
    // non-PAYMENT_HELD order.
    expect(orderRepository.updateStatusOptimistic).not.toHaveBeenCalled();
  });

  it("throws ORDER_WRONG_STATE when cancellation window has closed (past 24h)", async () => {
    const { cancelOrder } =
      await import("@/modules/orders/order-cancel.service");
    const { orderRepository } =
      await import("@/modules/orders/order.repository");

    vi.mocked(orderRepository.findByIdForCancel).mockResolvedValue({
      id: "order-closed",
      status: "PAYMENT_HELD",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48h ago
      stripePaymentIntentId: "pi_closed",
      listingId: "list-1",
      totalNzd: 5000,
    } as never);

    await expect(cancelOrder("order-closed", "buyer-1")).rejects.toThrow(
      /closed|cannot be cancelled/i,
    );
  });

  it("requires a reason for cancellations in the request window", async () => {
    const { cancelOrder } =
      await import("@/modules/orders/order-cancel.service");
    const { orderRepository } =
      await import("@/modules/orders/order.repository");

    vi.mocked(orderRepository.findByIdForCancel).mockResolvedValue({
      id: "order-req-window",
      status: "PAYMENT_HELD",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3h ago → request window
      stripePaymentIntentId: null, // cash — avoids Stripe refund path
      listingId: "list-1",
      totalNzd: 5000,
    } as never);

    await expect(
      cancelOrder("order-req-window", "buyer-1"), // no reason supplied
    ).rejects.toThrow(/reason/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// auto-resolution — additional factor + decision branches
// ═══════════════════════════════════════════════════════════════════════════

// Mock trust metrics + dispute service for this block specifically.
const mockGetBuyerMetricsD = vi.fn();
const mockGetSellerMetricsD = vi.fn();

vi.mock("@/modules/trust/trust-metrics.service", () => ({
  trustMetricsService: {
    getBuyerMetrics: (...args: unknown[]) => mockGetBuyerMetricsD(...args),
    getSellerMetrics: (...args: unknown[]) => mockGetSellerMetricsD(...args),
    computeMetrics: vi.fn(),
  },
}));

vi.mock("@/server/services/dispute/dispute.service", () => ({
  getDisputeByOrderId: vi.fn(),
  resolveDispute: vi.fn(),
  setAutoResolving: vi.fn(),
}));

describe("Fix 1.7 — auto-resolution: extra factor + decision branches", () => {
  const defaultBuyer = {
    totalOrders: 10,
    completedOrders: 9,
    disputeCount: 1,
    disputeRate: 10,
    disputesLast30Days: 0,
    accountAge: 365,
    isFlaggedForFraud: false,
  };
  const defaultSeller = {
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

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetBuyerMetricsD.mockResolvedValue(defaultBuyer);
    mockGetSellerMetricsD.mockResolvedValue(defaultSeller);

    const { getDisputeByOrderId } =
      await import("@/server/services/dispute/dispute.service");
    vi.mocked(getDisputeByOrderId).mockResolvedValue({
      id: "d-1",
      orderId: "o-1",
      reason: "ITEM_NOT_RECEIVED",
      openedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      sellerStatement: null,
      sellerRespondedAt: null,
      evidence: [],
    } as never);

    const { orderRepository } =
      await import("@/modules/orders/order.repository");
    vi.mocked(orderRepository.findForAutoResolutionEvaluate).mockResolvedValue({
      id: "o-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "DISPUTED",
      totalNzd: 50000,
      trackingNumber: "NZ123",
      dispatchedAt: null,
      completedAt: null,
      stripePaymentIntentId: "pi_test",
    } as never);
    vi.mocked(orderRepository.findDispatchEvent).mockResolvedValue(null);
    vi.mocked(orderRepository.findDeliveryOkEvent).mockResolvedValue(null);

    const { interactionRepository } =
      await import("@/modules/orders/interaction.repository");
    vi.mocked(
      interactionRepository.countPriorBuyerInteractions,
    ).mockResolvedValue(0);
    vi.mocked(interactionRepository.findRejectedByResponder).mockResolvedValue(
      null,
    );
  });

  it("applies BUYER_ATTEMPTED_RESOLUTION factor when buyer filed prior interactions", async () => {
    const { interactionRepository } =
      await import("@/modules/orders/interaction.repository");
    vi.mocked(
      interactionRepository.countPriorBuyerInteractions,
    ).mockResolvedValue(2);

    const { AutoResolutionService } =
      await import("@/modules/disputes/auto-resolution.service");
    const svc = new AutoResolutionService();
    const result = await svc.evaluateDispute("o-1");

    expect(
      result.factors.find((f) => f.factor === "BUYER_ATTEMPTED_RESOLUTION"),
    ).toBeDefined();
  });

  it("applies SELLER_REJECTED_WITHOUT_COUNTER factor when rejection exists", async () => {
    const { interactionRepository } =
      await import("@/modules/orders/interaction.repository");
    vi.mocked(interactionRepository.findRejectedByResponder).mockResolvedValue({
      id: "int-rej-1",
      status: "REJECTED",
    } as never);

    const { AutoResolutionService } =
      await import("@/modules/disputes/auto-resolution.service");
    const svc = new AutoResolutionService();
    const result = await svc.evaluateDispute("o-1");

    expect(
      result.factors.find(
        (f) => f.factor === "SELLER_REJECTED_WITHOUT_COUNTER",
      ),
    ).toBeDefined();
  });

  it("applies SELLER_HIGH_DISPUTE_RATE when rate breaches threshold with enough orders", async () => {
    mockGetSellerMetricsD.mockResolvedValue({
      ...defaultSeller,
      totalOrders: 20, // ≥ min orders
      disputeRate: 18, // > default 15
    });

    const { AutoResolutionService } =
      await import("@/modules/disputes/auto-resolution.service");
    const svc = new AutoResolutionService();
    const result = await svc.evaluateDispute("o-1");

    expect(
      result.factors.find((f) => f.factor === "SELLER_HIGH_DISPUTE_RATE"),
    ).toBeDefined();
  });

  it("applies SELLER_LOW_DISPUTE_RATE when rate is excellent with enough orders", async () => {
    mockGetSellerMetricsD.mockResolvedValue({
      ...defaultSeller,
      totalOrders: 100,
      disputeRate: 2, // < default 5
    });

    const { AutoResolutionService } =
      await import("@/modules/disputes/auto-resolution.service");
    const svc = new AutoResolutionService();
    const result = await svc.evaluateDispute("o-1");

    expect(
      result.factors.find((f) => f.factor === "SELLER_LOW_DISPUTE_RATE"),
    ).toBeDefined();
  });

  it("returns coolingPeriodHours=0 when decision cannot auto-resolve", async () => {
    // Default setup → mixed signals → ESCALATE_HUMAN
    const { AutoResolutionService } =
      await import("@/modules/disputes/auto-resolution.service");
    const svc = new AutoResolutionService();
    const result = await svc.evaluateDispute("o-1");

    if (result.canAutoResolve) {
      expect(result.coolingPeriodHours).toBeGreaterThan(0);
    } else {
      expect(result.coolingPeriodHours).toBe(0);
    }
  });

  it("flags fraud when seller exceeds fraud dispute rate and buyer is under rate limit", async () => {
    mockGetBuyerMetricsD.mockResolvedValue({
      ...defaultBuyer,
      disputesLast30Days: 2, // under BUYER_HUMAN_REVIEW_AFTER (3)
    });
    mockGetSellerMetricsD.mockResolvedValue({
      ...defaultSeller,
      totalOrders: 20,
      disputeRate: 25, // 25% > 20%
    });

    const { AutoResolutionService } =
      await import("@/modules/disputes/auto-resolution.service");
    const svc = new AutoResolutionService();
    const result = await svc.evaluateDispute("o-1");

    expect(result.decision).toBe("FLAG_FRAUD");
    expect(result.canAutoResolve).toBe(false);
    expect(result.recommendation).toMatch(/FRAUD FLAG/);
  });
});
