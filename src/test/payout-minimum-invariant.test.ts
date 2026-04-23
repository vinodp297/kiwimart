// src/test/payout-minimum-invariant.test.ts
// ─── Tests: payout amount floor invariant ────────────────────────────────────
// Verifies that the fee calculator flags orders where seller payout would be
// below the Stripe minimum transfer amount (50¢ NZD), and that the payout
// worker correctly handles these by updating status to MANUAL_REVIEW without
// attempting a Stripe transfer.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Capture BullMQ processor ──────────────────────────────────────────────────

const processorRef: { fn: ((job: unknown) => Promise<unknown>) | null } = {
  fn: null,
};

vi.mock("bullmq", () => ({
  Worker: class {
    constructor(_queue: string, processor: (job: unknown) => Promise<unknown>) {
      processorRef.fn = processor;
    }
    on(_event: string, _handler: unknown) {}
    isRunning() {
      return true;
    }
    isPaused() {
      return false;
    }
  },
}));

vi.mock("@/lib/queue", () => ({
  getQueueConnection: vi.fn().mockReturnValue({}),
  payoutQueue: { add: vi.fn() },
  // Stub per-queue configs — workers import the backoffStrategy at construction.
  EMAIL_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  IMAGE_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  PAYOUT_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  PICKUP_QUEUE_CONFIG: { backoffStrategy: () => 0 },
}));

// ── Stripe mock ───────────────────────────────────────────────────────────────

const mockTransferCreate = vi.fn();

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    accounts: {
      retrieve: vi
        .fn()
        .mockResolvedValue({ id: "acct_test123", payouts_enabled: true }),
    },
    transfers: { create: (...args: unknown[]) => mockTransferCreate(...args) },
  },
}));

// ── Fee calculator mock — controllable per test ───────────────────────────────

const mockCalculateFees = vi.fn();

vi.mock("@/modules/payments/fee-calculator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/payments/fee-calculator")>();
  return {
    ...actual,
    calculateFees: (...args: unknown[]) => mockCalculateFees(...args),
  };
});

// ── Email mock ────────────────────────────────────────────────────────────────

vi.mock("@/server/email", () => ({
  sendPayoutInitiatedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));

// ── Import worker + start ─────────────────────────────────────────────────────

import { startPayoutWorker } from "@/server/workers/payoutWorker";
import db from "@/lib/db";
import {
  calculateFeesSync,
  MINIMUM_PAYOUT_CENTS,
} from "@/modules/payments/fee-calculator";

startPayoutWorker();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payoutMock = db.payout as any;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob() {
  return {
    id: "job-1",
    data: {
      orderId: "order-abc",
      sellerId: "seller-xyz",
      stripeAccountId: "acct_test123",
      correlationId: "test-corr-id",
    },
  };
}

const HEALTHY_FEES = {
  grossAmountCents: 10000,
  stripeFee: 220,
  platformFee: 350,
  platformFeeRate: 0.035,
  totalFees: 570,
  sellerPayout: 9430,
  tier: "STANDARD" as const,
};

const MANUAL_REVIEW_FEES = {
  grossAmountCents: 100,
  stripeFee: 32,
  platformFee: 50,
  platformFeeRate: 0.035,
  totalFees: 82,
  sellerPayout: 0,
  tier: "STANDARD" as const,
  requiresManualReview: true,
  manualReviewReason: "Fees exceed seller payout — manual review required",
};

// ── Fee calculator unit tests ─────────────────────────────────────────────────

describe("fee-calculator — minimum payout invariant", () => {
  it("sets requiresManualReview when gross order is $1 (100¢) with standard fees", () => {
    // At $1.00 (100¢): stripeFee ≈ 32¢, platformFee clamped to 50¢ minimum
    // totalFees = 82¢ → sellerPayout = 18¢ < 50¢ → requiresManualReview
    const breakdown = calculateFeesSync(100);

    expect(breakdown.requiresManualReview).toBe(true);
    expect(breakdown.sellerPayout).toBe(0);
    expect(breakdown.manualReviewReason).toBeDefined();
    expect(breakdown.manualReviewReason).toContain("manual review");
  });

  it("does not set requiresManualReview for a $100 order (10000¢)", () => {
    const breakdown = calculateFeesSync(10000);

    expect(breakdown.requiresManualReview).toBeUndefined();
    expect(breakdown.sellerPayout).toBeGreaterThanOrEqual(MINIMUM_PAYOUT_CENTS);
  });

  it("MINIMUM_PAYOUT_CENTS is 50 (Stripe NZD minimum transfer)", () => {
    expect(MINIMUM_PAYOUT_CENTS).toBe(50);
  });
});

// ── Payout worker integration tests ──────────────────────────────────────────

describe("payout worker — manual review guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    if (!payoutMock.findUnique) payoutMock.findUnique = vi.fn();
    if (!payoutMock.update) payoutMock.update = vi.fn();

    payoutMock.findUnique.mockResolvedValue({
      id: "payout-123",
      status: "PENDING",
      amountNzd: 100,
      effectiveFeeRateBps: 0,
    });
    payoutMock.update.mockResolvedValue({ id: "payout-123" });

    vi.mocked(db.user.findUnique).mockResolvedValue({
      email: "seller@example.com",
      displayName: "Test Seller",
      sellerTierOverride: null,
    } as never);

    vi.mocked(db.order.findUnique).mockResolvedValue({
      listing: { title: "Test Item" },
    } as never);

    mockTransferCreate.mockResolvedValue({ id: "tr_test123" });
  });

  it("does not call Stripe transfer when requiresManualReview is true", async () => {
    mockCalculateFees.mockResolvedValue(MANUAL_REVIEW_FEES);

    await processorRef.fn!(makeJob());

    expect(mockTransferCreate).not.toHaveBeenCalled();
  });

  it("updates payout status to MANUAL_REVIEW when fees exceed minimum", async () => {
    mockCalculateFees.mockResolvedValue(MANUAL_REVIEW_FEES);

    await processorRef.fn!(makeJob());

    expect(payoutMock.update).toHaveBeenCalledWith({
      where: { orderId: "order-abc" },
      data: { status: "MANUAL_REVIEW" },
    });
  });

  it("proceeds with Stripe transfer for a healthy-margin order", async () => {
    mockCalculateFees.mockResolvedValue(HEALTHY_FEES);
    payoutMock.findUnique.mockResolvedValue({
      id: "payout-456",
      status: "PENDING",
      amountNzd: 10000,
      effectiveFeeRateBps: 0,
    });

    await processorRef.fn!(makeJob());

    expect(mockTransferCreate).toHaveBeenCalledOnce();
    expect(payoutMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PROCESSING" }),
      }),
    );
  });
});
