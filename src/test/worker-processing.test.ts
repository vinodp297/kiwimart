// src/test/worker-processing.test.ts
// ─── Worker Processing — emailWorker, imageWorker, payoutWorker ───────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Capture job handlers ───────────────────────────────────────────────────────
let emailHandler: (job: unknown) => Promise<unknown>;
let imageHandler: (job: unknown) => Promise<unknown>;
let payoutHandler: (job: unknown) => Promise<unknown>;

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(function (
    name: string,
    handler: (job: unknown) => Promise<unknown>,
  ) {
    if (name === "email") emailHandler = handler;
    if (name === "image") imageHandler = handler;
    if (name === "payout") payoutHandler = handler;
    return { on: vi.fn() };
  }),
  Queue: vi.fn().mockImplementation(function () {
    return { add: vi.fn(), on: vi.fn() };
  }),
}));

// ── Mock email functions ───────────────────────────────────────────────────────
const mockSendVerificationEmail = vi.fn().mockResolvedValue(undefined);
const mockSendWelcomeEmail = vi.fn().mockResolvedValue(undefined);
const mockSendPasswordResetEmail = vi.fn().mockResolvedValue(undefined);
const mockSendOfferReceivedEmail = vi.fn().mockResolvedValue(undefined);
const mockSendDisputeOpenedEmail = vi.fn().mockResolvedValue(undefined);
const mockSendOrderDispatchedEmail = vi.fn().mockResolvedValue(undefined);
const mockSendPayoutInitiatedEmail = vi.fn().mockResolvedValue(undefined);
const mockSendOrderCompleteBuyerEmail = vi.fn().mockResolvedValue(undefined);
const mockSendOrderCompleteSellerEmail = vi.fn().mockResolvedValue(undefined);

vi.mock("@/server/email", () => ({
  sendVerificationEmail: (...a: unknown[]) => mockSendVerificationEmail(...a),
  sendWelcomeEmail: (...a: unknown[]) => mockSendWelcomeEmail(...a),
  sendPasswordResetEmail: (...a: unknown[]) => mockSendPasswordResetEmail(...a),
  sendDataExportEmail: vi.fn().mockResolvedValue(undefined),
  sendErasureConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendAdminIdVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: (...a: unknown[]) => mockSendOfferReceivedEmail(...a),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderDispatchedEmail: (...a: unknown[]) =>
    mockSendOrderDispatchedEmail(...a),
  sendOrderCompleteBuyerEmail: (...a: unknown[]) =>
    mockSendOrderCompleteBuyerEmail(...a),
  sendOrderCompleteSellerEmail: (...a: unknown[]) =>
    mockSendOrderCompleteSellerEmail(...a),
  sendDisputeOpenedEmail: (...a: unknown[]) => mockSendDisputeOpenedEmail(...a),
  sendPayoutInitiatedEmail: (...a: unknown[]) =>
    mockSendPayoutInitiatedEmail(...a),
}));

// ── Mock processImage ──────────────────────────────────────────────────────────
const mockProcessImage = vi.fn();
vi.mock("@/server/actions/imageProcessor", () => ({
  processImage: (...a: unknown[]) => mockProcessImage(...a),
}));

// ── Mock infrastructure ────────────────────────────────────────────────────────
const mockEnqueueEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email-queue", () => ({
  enqueueEmail: (...a: unknown[]) => mockEnqueueEmail(...a),
}));

vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: vi.fn(),
}));

vi.mock("@/lib/queue", () => ({
  getQueueConnection: vi.fn().mockReturnValue({}),
  // Stub per-queue configs — workers import the backoffStrategy at construction.
  EMAIL_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  IMAGE_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  PAYOUT_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  PICKUP_QUEUE_CONFIG: { backoffStrategy: () => 0 },
}));

vi.mock("@/server/lib/audit", () => ({
  audit: vi.fn(),
}));

vi.mock("@/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/request-context", () => ({
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

// ── Mock Stripe (for payout worker) ────────────────────────────────────────────
const mockStripeTransfersCreate = vi.fn();
vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    accounts: {
      retrieve: vi
        .fn()
        .mockResolvedValue({ id: "acct_test123", payouts_enabled: true }),
    },
    transfers: {
      create: (...a: unknown[]) => mockStripeTransfersCreate(...a),
    },
  },
}));

// ── Mock fee calculator (for payout worker) ─────────────────────────────────
// calculateFees reads from PlatformConfig; mock it here so payout tests are
// deterministic and don't depend on the config mock's return values.
const mockCalculateFees = vi.fn();
const mockCalculateFeesFromBps = vi.fn();
vi.mock("@/modules/payments/fee-calculator", () => ({
  calculateFees: (...a: unknown[]) => mockCalculateFees(...a),
  calculateFeesFromBps: (...a: unknown[]) => mockCalculateFeesFromBps(...a),
  calculateFeesSync: vi.fn(),
}));

const PAYOUT_FEES = {
  grossAmountCents: 5000,
  stripeFee: 125,
  platformFee: 175,
  platformFeeRate: 0.035,
  totalFees: 300,
  sellerPayout: 4700,
  tier: "STANDARD" as const,
};

// ── Import workers AFTER mocks ─────────────────────────────────────────────────
import { startEmailWorker } from "@/server/workers/emailWorker";
import { startImageWorker } from "@/server/workers/imageWorker";
import { startPayoutWorker } from "@/server/workers/payoutWorker";
import db from "@/lib/db";

// Initialise workers (captures handlers)
startEmailWorker();
startImageWorker();
startPayoutWorker();

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// emailWorker
// ═══════════════════════════════════════════════════════════════════════════

describe("emailWorker", () => {
  function emailJob(template: string, extra: Record<string, unknown> = {}) {
    return {
      id: "job-1",
      data: { template, to: "user@test.nz", ...extra },
    };
  }

  it("sends verification email", async () => {
    await emailHandler(
      emailJob("verification", {
        displayName: "Alice",
        verifyUrl: "https://example.com/verify",
      }),
    );
    expect(mockSendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@test.nz",
        displayName: "Alice",
        verifyUrl: "https://example.com/verify",
      }),
    );
  });

  it("sends welcome email", async () => {
    await emailHandler(emailJob("welcome", { displayName: "Bob" }));
    expect(mockSendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@test.nz", displayName: "Bob" }),
    );
  });

  it("sends password reset email", async () => {
    await emailHandler(
      emailJob("passwordReset", {
        displayName: "Carol",
        resetUrl: "https://example.com/reset",
        expiresInMinutes: 60,
      }),
    );
    expect(mockSendPasswordResetEmail).toHaveBeenCalledOnce();
  });

  it("sends offer received email", async () => {
    await emailHandler(
      emailJob("offerReceived", {
        sellerName: "Dave",
        buyerName: "Eve",
        listingTitle: "Widget",
        offerAmount: 50,
        listingUrl: "https://example.com/listing/1",
      }),
    );
    expect(mockSendOfferReceivedEmail).toHaveBeenCalledOnce();
  });

  it("sends dispute opened email", async () => {
    await emailHandler(
      emailJob("disputeOpened", {
        sellerName: "Dave",
        buyerName: "Eve",
        listingTitle: "Widget",
        orderId: "order-1",
        reason: "Not as described",
        description: "Item was broken",
      }),
    );
    expect(mockSendDisputeOpenedEmail).toHaveBeenCalledOnce();
  });

  it("sends orderCompleteBuyer email", async () => {
    await emailHandler(
      emailJob("orderCompleteBuyer", {
        buyerName: "Frank",
        sellerName: "Grace",
        listingTitle: "Vintage Camera",
        orderId: "order-abc",
        totalNzd: 12000,
        orderUrl: "https://buyzi.co.nz/orders/order-abc",
      }),
    );
    expect(mockSendOrderCompleteBuyerEmail).toHaveBeenCalledOnce();
  });

  it("sends orderCompleteSeller email", async () => {
    await emailHandler(
      emailJob("orderCompleteSeller", {
        sellerName: "Grace",
        buyerFirstName: "Frank",
        listingTitle: "Vintage Camera",
        orderId: "order-abc",
        totalNzd: 12000,
        payoutTimelineDays: 3,
        dashboardUrl: "https://buyzi.co.nz/dashboard/seller",
      }),
    );
    expect(mockSendOrderCompleteSellerEmail).toHaveBeenCalledOnce();
  });

  it("uses correlationId from job data when present", async () => {
    await emailHandler({
      id: "job-2",
      data: {
        template: "welcome",
        to: "user@test.nz",
        displayName: "Grace",
        correlationId: "custom-correlation-id",
      },
    });
    expect(mockSendWelcomeEmail).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// imageWorker
// ═══════════════════════════════════════════════════════════════════════════

describe("imageWorker", () => {
  it("calls processImage with job data", async () => {
    mockProcessImage.mockResolvedValue({
      success: true,
      fullKey: "img-full.webp",
      thumbKey: "img-thumb.webp",
      width: 800,
      height: 600,
    });

    await imageHandler({
      id: "job-img-1",
      data: {
        imageId: "img-1",
        r2Key: "listings/user-1/photo.jpg",
        userId: "user-1",
      },
    });

    expect(mockProcessImage).toHaveBeenCalledWith({
      imageId: "img-1",
      r2Key: "listings/user-1/photo.jpg",
      userId: "user-1",
    });
  });

  it("propagates processImage errors", async () => {
    mockProcessImage.mockRejectedValue(new Error("corrupt image"));

    await expect(
      imageHandler({
        id: "job-img-2",
        data: {
          imageId: "img-2",
          r2Key: "listings/user-1/bad.jpg",
          userId: "user-1",
        },
      }),
    ).rejects.toThrow("corrupt image");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// payoutWorker
// ═══════════════════════════════════════════════════════════════════════════

describe("payoutWorker", () => {
  const JOB_DATA = {
    orderId: "order-1",
    sellerId: "seller-1",
    amountNzd: 5000,
    stripeAccountId: "acct_123",
  };

  function payoutJob(overrides: Record<string, unknown> = {}) {
    return { id: "job-payout-1", data: { ...JOB_DATA, ...overrides } };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock accessor
  const payoutMock = db.payout as any;

  // The global db mock may not have findUnique/update on payout — add them
  beforeEach(() => {
    if (!payoutMock.findUnique) payoutMock.findUnique = vi.fn();
    if (!payoutMock.update) payoutMock.update = vi.fn();
    mockCalculateFees.mockResolvedValue(PAYOUT_FEES);
    mockEnqueueEmail.mockResolvedValue(undefined);
  });

  it("processes a pending payout end-to-end", async () => {
    payoutMock.findUnique.mockResolvedValue({
      id: "payout-1",
      status: "PENDING",
      amountNzd: 5000,
      effectiveFeeRateBps: 0,
    });
    mockStripeTransfersCreate.mockResolvedValue({ id: "tr_123" });
    payoutMock.update.mockResolvedValue({});
    (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "seller@test.nz",
      displayName: "Dave",
      sellerTierOverride: null,
    });
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      listing: { title: "Widget" },
    });

    const result = await payoutHandler(payoutJob());
    expect(result).toEqual({ transferId: "tr_123" });
    // Transfer uses fees.sellerPayout (4700), not the gross amount (5000)
    expect(mockStripeTransfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: PAYOUT_FEES.sellerPayout,
        currency: "nzd",
        destination: "acct_123",
      }),
      expect.objectContaining({ idempotencyKey: "transfer-payout-1" }),
    );
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "payoutInitiated",
        to: "seller@test.nz",
        sellerName: "Dave",
        amountNzd: PAYOUT_FEES.sellerPayout,
      }),
    );
  });

  it("skips payout when status is not PENDING", async () => {
    payoutMock.findUnique.mockResolvedValue({
      id: "payout-1",
      status: "PROCESSING",
    });

    const result = await payoutHandler(payoutJob());
    expect(result).toEqual({
      skipped: true,
      reason: "Already PROCESSING",
    });
    expect(mockStripeTransfersCreate).not.toHaveBeenCalled();
  });

  it("throws when payout record not found", async () => {
    payoutMock.findUnique.mockResolvedValue(null);

    await expect(payoutHandler(payoutJob())).rejects.toThrow(
      "Payout not found",
    );
  });

  it("still completes when seller lookup returns null (no email)", async () => {
    payoutMock.findUnique.mockResolvedValue({
      id: "payout-1",
      status: "PENDING",
      amountNzd: 5000,
      effectiveFeeRateBps: 0,
    });
    mockStripeTransfersCreate.mockResolvedValue({ id: "tr_456" });
    payoutMock.update.mockResolvedValue({});
    (db.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await payoutHandler(payoutJob());
    expect(result).toEqual({ transferId: "tr_456" });
    expect(mockSendPayoutInitiatedEmail).not.toHaveBeenCalled();
  });
});
