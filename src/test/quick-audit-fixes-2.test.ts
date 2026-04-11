// src/test/quick-audit-fixes-2.test.ts
// ─── Tests: four production-audit fixes ──────────────────────────────────────
//   1-2. Pickup worker refund failure → logged + rethrown
//     3. Log-sanitiser redacts Stripe identifiers
//   4-5. Account erasure uses updateMany(senderId=null) not deleteMany
//   6-8. Payout worker skips and logs when seller account is disabled

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Capture BullMQ processors in order ───────────────────────────────────────
// Index 0 = pickup worker, index 1 = payout worker.
// Both workers are started at module level below.
const processorRefs: ((job: unknown) => Promise<unknown>)[] = [];

vi.mock("bullmq", () => ({
  Worker: class {
    constructor(_queue: string, processor: (job: unknown) => Promise<unknown>) {
      processorRefs.push(processor);
    }
    on(_event: string, _handler: unknown) {}
  },
}));

vi.mock("@/lib/queue", () => ({
  getQueueConnection: vi.fn().mockReturnValue({}),
  payoutQueue: { add: vi.fn() },
  emailQueue: { add: vi.fn() },
  pickupQueue: { add: vi.fn() },
}));

// ── Stripe mock (used by both pickup payment.service and payout worker) ───────
const mockRefundPayment = vi.fn();
const mockStripeAccountsRetrieve = vi.fn();
const mockStripeTransfersCreate = vi.fn();

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    refundPayment: (...args: unknown[]) => mockRefundPayment(...args),
    capturePayment: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    accounts: {
      retrieve: (...args: unknown[]) => mockStripeAccountsRetrieve(...args),
    },
    transfers: {
      create: (...args: unknown[]) => mockStripeTransfersCreate(...args),
    },
    paymentIntents: { capture: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
    refunds: { create: vi.fn().mockResolvedValue({ id: "re_test" }) },
  },
}));

vi.mock("@/infrastructure/stripe/with-timeout", () => ({
  withStripeTimeout: (fn: () => Promise<unknown>) => fn(),
}));

// ── Pickup worker dependencies ────────────────────────────────────────────────
vi.mock("@/lib/transaction", () => ({
  withTransaction: vi
    .fn()
    .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({}),
    ),
}));

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findForPickupHandler: vi.fn().mockResolvedValue({
      id: "ord-1",
      status: "PAYMENT_HELD",
      pickupStatus: "AWAITING_SCHEDULE",
      stripePaymentIntentId: "pi_test_abc",
      sellerId: "seller-1",
      buyerId: "buyer-1",
      listingId: "lst-1",
      fulfillmentType: "ONLINE_PAYMENT_PICKUP",
    }),
    findListingTitleForOrder: vi.fn().mockResolvedValue("Test Item"),
    countActiveOrdersForUser: vi.fn().mockResolvedValue(0),
    $transaction: vi
      .fn()
      .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({})),
  },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/listings/listing.repository", () => ({
  listingRepository: {
    releaseReservation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/trust/trust-metrics.repository", () => ({
  trustMetricsRepository: {
    incrementDisputeCount: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findEmailInfo: vi.fn().mockResolvedValue({
      email: "user@example.com",
      displayName: "Test User",
    }),
    update: vi.fn().mockResolvedValue(undefined),
    deleteAllSessions: vi.fn().mockResolvedValue(undefined),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
    findSellerForPayout: vi.fn().mockResolvedValue({
      email: "seller@example.com",
      displayName: "Test Seller",
      sellerTierOverride: null,
    }),
    findEmailVerified: vi
      .fn()
      .mockResolvedValue({ emailVerified: new Date("2025-01-01") }),
  },
}));

vi.mock("@/modules/pickup/pickup.repository", () => ({
  pickupRepository: {
    findActiveRequest: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn().mockResolvedValue(undefined) },
  ORDER_EVENT_TYPES: { CANCELLED: "CANCELLED" },
  ACTOR_ROLES: { SYSTEM: "SYSTEM" },
}));

vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: vi.fn(),
}));

vi.mock("@/lib/request-context", () => ({
  runWithRequestContext: vi
    .fn()
    .mockImplementation((_ctx: unknown, fn: () => Promise<unknown>) => fn()),
  getRequestContext: () => null,
}));

// ── Payout worker dependencies ────────────────────────────────────────────────
const mockMarkManualReview = vi.fn();
const mockFindByOrderId = vi.fn();

vi.mock("@/modules/payments/payout.repository", () => ({
  payoutRepository: {
    findByOrderId: (...args: unknown[]) => mockFindByOrderId(...args),
    markManualReview: (...args: unknown[]) => mockMarkManualReview(...args),
    markProcessingWithTransfer: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/payments/fee-calculator", () => ({
  calculateFees: vi.fn().mockResolvedValue({
    grossAmountCents: 10000,
    stripeFee: 220,
    platformFee: 350,
    sellerPayout: 9430,
    tier: "STANDARD",
    requiresManualReview: false,
  }),
  calculateFeesSync: vi.fn(),
}));

vi.mock("@/server/email", () => ({
  sendPayoutInitiatedEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendDataExportEmail: vi.fn().mockResolvedValue(undefined),
  sendErasureConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendAdminIdVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendDisputeOpenedEmail: vi.fn().mockResolvedValue(undefined),
  sendDisputeResolvedEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Erasure service dependencies ──────────────────────────────────────────────
vi.mock("@/server/lib/sessionStore", () => ({
  invalidateAllSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/mobile-auth", () => ({
  revokeAllMobileTokens: vi.fn().mockResolvedValue(undefined),
}));

// ── Start both workers — processors captured by the mock constructor ──────────
import { startPickupWorker } from "@/server/workers/pickupWorker";
import { startPayoutWorker } from "@/server/workers/payoutWorker";

startPickupWorker(); // processorRefs[0]
startPayoutWorker(); // processorRefs[1]

// ── Imports used in tests ─────────────────────────────────────────────────────
import { sanitiseLogContext } from "@/lib/log-sanitiser";
import { performAccountErasure } from "@/modules/users/erasure.service";
import db from "@/lib/db";

// ── Helper ────────────────────────────────────────────────────────────────────

function makePayoutJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-payout-1",
    data: {
      orderId: "order-xyz",
      sellerId: "seller-123",
      stripeAccountId: "acct_test456",
      amountNzd: 10000,
      ...overrides,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1-2. Pickup worker — refund failure rethrown
// ═══════════════════════════════════════════════════════════════════════════════

describe("pickup worker — refund failure rethrown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefundPayment.mockReset();
  });

  it("rethrows refund error so BullMQ can DLQ the job", async () => {
    mockRefundPayment.mockRejectedValue(new Error("Stripe refund timeout"));

    const job = {
      id: "job-1",
      data: { type: "PICKUP_SCHEDULE_DEADLINE", orderId: "ord-1" },
    };

    await expect(processorRefs[0]!(job)).rejects.toThrow(
      "Stripe refund timeout",
    );
  });

  it("logs requiresManualReconciliation=true when refund fails", async () => {
    mockRefundPayment.mockRejectedValue(new Error("Card declined"));

    const { logger } = await import("@/shared/logger");

    const job = {
      id: "job-2",
      data: { type: "PICKUP_SCHEDULE_DEADLINE", orderId: "ord-1" },
    };

    await expect(processorRefs[0]!(job)).rejects.toThrow();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "pickup.schedule_deadline.refund_failed",
      expect.objectContaining({
        orderId: "ord-1",
        requiresManualReconciliation: true,
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Log-sanitiser — Stripe identifiers redacted
// ═══════════════════════════════════════════════════════════════════════════════

describe("log-sanitiser — Stripe identifiers redacted", () => {
  it("redacts all seven Stripe ID keys to [redacted]", () => {
    const ctx = {
      stripeCustomerId: "cus_abc123",
      stripeAccountId: "acct_xyz789",
      paymentIntentId: "pi_test001",
      stripePaymentIntentId: "pi_test002",
      chargeId: "ch_test003",
      transferId: "tr_test004",
      payoutId: "po_test005",
      safeField: "keep-me",
    };

    const result = sanitiseLogContext(ctx);

    expect(result.stripeCustomerId).toBe("[redacted]");
    expect(result.stripeAccountId).toBe("[redacted]");
    expect(result.paymentIntentId).toBe("[redacted]");
    expect(result.stripePaymentIntentId).toBe("[redacted]");
    expect(result.chargeId).toBe("[redacted]");
    expect(result.transferId).toBe("[redacted]");
    expect(result.payoutId).toBe("[redacted]");
    expect(result.safeField).toBe("keep-me");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4-5. Erasure — messages anonymised not deleted
// ═══════════════════════════════════════════════════════════════════════════════

describe("account erasure — messages anonymised not deleted", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // userRepository.transaction passes tx=db so erasure can call db.message.updateMany
    const { userRepository } = await import("@/modules/users/user.repository");
    vi.mocked(
      userRepository.findEmailInfo as ReturnType<typeof vi.fn>,
    ).mockResolvedValue({
      email: "user@example.com",
      displayName: "Test User",
    });
    vi.mocked(
      userRepository.update as ReturnType<typeof vi.fn>,
    ).mockResolvedValue(undefined);
    vi.mocked(
      userRepository.deleteAllSessions as ReturnType<typeof vi.fn>,
    ).mockResolvedValue(undefined);
    vi.mocked(
      userRepository.transaction as ReturnType<typeof vi.fn>,
    ).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(db),
    );

    const { orderRepository } =
      await import("@/modules/orders/order.repository");
    vi.mocked(
      orderRepository.countActiveOrdersForUser as ReturnType<typeof vi.fn>,
    ).mockResolvedValue(0);

    // db methods needed inside the transaction
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 3 });
    vi.mocked(db.message.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(db.watchlistItem.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(db.review.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(db.offer.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(db.erasureLog.create).mockResolvedValue({
      id: "erasure-log-1",
    } as never);
  });

  it("calls message.updateMany instead of deleteMany", async () => {
    await performAccountErasure({
      userId: "user-001",
      operatorId: "self-service",
    });

    expect(db.message.updateMany).toHaveBeenCalled();
    expect(db.message.deleteMany).not.toHaveBeenCalled();
  });

  it("sets senderId to null (not deletes) when anonymising messages", async () => {
    await performAccountErasure({
      userId: "user-001",
      operatorId: "self-service",
    });

    expect(db.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ senderId: "user-001" }),
        data: expect.objectContaining({ senderId: null }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6-8. Payout worker — seller account validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("payout worker — seller account validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindByOrderId.mockResolvedValue({
      id: "payout-abc",
      status: "PENDING",
      amountNzd: 10000,
    });
    mockMarkManualReview.mockResolvedValue(undefined);
    mockStripeTransfersCreate.mockResolvedValue({
      id: "tr_test123",
      amount: 9430,
    });
  });

  it("skips payout when seller payouts_enabled is false", async () => {
    mockStripeAccountsRetrieve.mockResolvedValue({
      id: "acct_test456",
      payouts_enabled: false,
    });

    const result = await processorRefs[1]!(makePayoutJob());

    expect(mockStripeTransfersCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      skipped: true,
      reason: "seller_account_disabled",
    });
  });

  it("proceeds with transfer when seller payouts_enabled is true", async () => {
    mockStripeAccountsRetrieve.mockResolvedValue({
      id: "acct_test456",
      payouts_enabled: true,
    });

    await processorRefs[1]!(makePayoutJob());

    expect(mockStripeTransfersCreate).toHaveBeenCalledOnce();
  });

  it("logs payout.seller_account_disabled at ERROR level when account disabled", async () => {
    mockStripeAccountsRetrieve.mockResolvedValue({
      id: "acct_test456",
      payouts_enabled: false,
    });

    const { logger } = await import("@/shared/logger");
    await processorRefs[1]!(makePayoutJob());

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "payout.seller_account_disabled",
      expect.objectContaining({
        orderId: "order-xyz",
        stripeAccountId: "acct_test456",
      }),
    );
  });
});
