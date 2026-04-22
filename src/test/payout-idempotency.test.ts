// src/test/payout-idempotency.test.ts
// ─── Tests: payout worker — idempotency, locking, fee calculation ─────────
//
// Tests capture the BullMQ Worker processor via a mock constructor so the
// handler can be invoked directly without needing a real Redis/BullMQ setup.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Capture BullMQ processor ─────────────────────────────────────────────────
// vi.mock is hoisted — factory runs before any module code.
// We capture the processor via a ref object (const avoids TDZ issues).

const processorRef: {
  fn: ((job: unknown) => Promise<unknown>) | null;
} = { fn: null };

vi.mock("bullmq", () => ({
  Worker: class {
    constructor(_queue: string, processor: (job: unknown) => Promise<unknown>) {
      processorRef.fn = processor;
    }
    on(_event: string, _handler: unknown) {}
  },
}));

// ── Mock queue (adds getQueueConnection which the worker imports) ────────────
vi.mock("@/lib/queue", () => ({
  getQueueConnection: vi.fn().mockReturnValue({}),
  payoutQueue: { add: vi.fn() },
  emailQueue: { add: vi.fn() },
  // Stub per-queue configs — workers import the backoffStrategy at construction.
  EMAIL_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  IMAGE_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  PAYOUT_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  PICKUP_QUEUE_CONFIG: { backoffStrategy: () => 0 },
}));

// ── Mock Stripe client ────────────────────────────────────────────────────────

const mockTransferCreate = vi.fn();

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    accounts: {
      retrieve: vi
        .fn()
        .mockResolvedValue({ id: "acct_test123", payouts_enabled: true }),
    },
    transfers: {
      create: (...args: unknown[]) => mockTransferCreate(...args),
    },
  },
}));

// ── Mock email (adds sendPayoutInitiatedEmail not in global setup mock) ─────

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
}));

// ── Mock fee calculator ──────────────────────────────────────────────────────

const mockCalculateFees = vi.fn();
const mockCalculateFeesFromBps = vi.fn();

vi.mock("@/modules/payments/fee-calculator", () => ({
  calculateFees: (...args: unknown[]) => mockCalculateFees(...args),
  calculateFeesFromBps: (...args: unknown[]) =>
    mockCalculateFeesFromBps(...args),
  calculateFeesSync: vi.fn(),
}));

// ── Import worker and start (captures processor via mocked BullMQ) ───────────
import { startPayoutWorker } from "@/server/workers/payoutWorker";
startPayoutWorker();

// ── Helpers ──────────────────────────────────────────────────────────────────

interface MockJob {
  id?: string;
  data: {
    orderId: string;
    sellerId: string;
    stripeAccountId: string;
    amountNzd: number;
    correlationId?: string;
  };
}

function makeJob(overrides: Partial<MockJob["data"]> = {}): MockJob {
  return {
    id: "job-1",
    data: {
      orderId: "order-abc",
      sellerId: "seller-xyz",
      stripeAccountId: "acct_test123",
      amountNzd: 10000,
      ...overrides,
    },
  };
}

const DEFAULT_FEES = {
  grossAmountCents: 10000,
  stripeFee: 220,
  platformFee: 350,
  platformFeeRate: 0.035,
  totalFees: 570,
  sellerPayout: 9430,
  tier: "STANDARD" as const,
};

// Typed payout mock accessor
type PayoutMock = {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
};

// ── Test setup ────────────────────────────────────────────────────────────────

import db from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payoutMock = db.payout as any as PayoutMock;

beforeEach(() => {
  vi.clearAllMocks();

  // Add payout methods the global mock doesn't include
  if (!payoutMock.findUnique) payoutMock.findUnique = vi.fn();
  if (!payoutMock.update) payoutMock.update = vi.fn();

  payoutMock.findUnique.mockResolvedValue({
    id: "payout-123",
    status: "PENDING",
    amountNzd: 10000,
    // Default: 0 = no snapshot yet, worker will compute via live config
    // and snapshot the rate. Individual tests override to simulate a retry.
    effectiveFeeRateBps: 0,
  });
  payoutMock.update.mockResolvedValue({ id: "payout-123" });

  vi.mocked(db.user.findUnique).mockResolvedValue({
    sellerTierOverride: null,
    email: "seller@example.com",
    displayName: "Test Seller",
  } as never);

  vi.mocked(db.order.findUnique).mockResolvedValue({
    listing: { title: "Test Item" },
  } as never);

  mockCalculateFees.mockResolvedValue(DEFAULT_FEES);
  mockTransferCreate.mockResolvedValue({ id: "tr_test123", amount: 9430 });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("payout worker — idempotency key", () => {
  it("creates transfer with idempotency key format transfer-${payout.id}", async () => {
    await processorRef.fn!(makeJob());

    expect(mockTransferCreate).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: "transfer-payout-123",
    });
  });

  it("transfer description includes orderId", async () => {
    await processorRef.fn!(makeJob({ orderId: "order-abc" }));

    expect(mockTransferCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("order-abc"),
      }),
      expect.anything(),
    );
  });

  it("same payout.id always produces same idempotency key on retry", async () => {
    await processorRef.fn!(makeJob());
    await processorRef.fn!(makeJob());

    const calls = mockTransferCreate.mock.calls as [
      unknown,
      { idempotencyKey: string },
    ][];
    expect(calls[0]![1].idempotencyKey).toBe(calls[1]![1].idempotencyKey);
    expect(calls[0]![1].idempotencyKey).toBe("transfer-payout-123");
  });
});

describe("payout worker — distributed lock", () => {
  it("withLockAndHeartbeat is called before initiating transfer", async () => {
    const { withLockAndHeartbeat } =
      await import("@/server/lib/distributedLock");

    await processorRef.fn!(makeJob());

    const lockOrder =
      vi.mocked(withLockAndHeartbeat).mock.invocationCallOrder[0] ?? 0;
    const transferOrder =
      mockTransferCreate.mock.invocationCallOrder[0] ?? Infinity;
    expect(lockOrder).toBeLessThan(transferOrder);
  });

  it("withLockAndHeartbeat is called with orderId key and correct options", async () => {
    const { withLockAndHeartbeat } =
      await import("@/server/lib/distributedLock");

    await processorRef.fn!(makeJob({ orderId: "order-abc" }));

    expect(vi.mocked(withLockAndHeartbeat)).toHaveBeenCalledWith(
      "payout:order-abc",
      expect.any(Function),
      expect.objectContaining({
        ttlSeconds: 120,
        heartbeatIntervalSeconds: 40,
      }),
    );
  });

  it("lock failure throws so BullMQ retries the job (not silent complete)", async () => {
    const { withLockAndHeartbeat } =
      await import("@/server/lib/distributedLock");
    // Simulate lock contention — withLockAndHeartbeat throws on lock miss
    vi.mocked(withLockAndHeartbeat).mockRejectedValueOnce(
      new Error("Lock contention — will retry"),
    );

    // Must THROW — BullMQ marks thrown jobs as FAILED and retries.
    // Returning would mark the job COMPLETE with no payout and no error.
    await expect(processorRef.fn!(makeJob())).rejects.toThrow();

    // Stripe transfer must NOT have been attempted
    expect(mockTransferCreate).not.toHaveBeenCalled();
  });

  it("lock miss does not attempt Stripe transfer", async () => {
    const { withLockAndHeartbeat } =
      await import("@/server/lib/distributedLock");
    vi.mocked(withLockAndHeartbeat).mockRejectedValueOnce(
      new Error("Lock not available"),
    );

    await expect(processorRef.fn!(makeJob())).rejects.toThrow();

    // No transfer attempted when lock was not acquired
    expect(mockTransferCreate).not.toHaveBeenCalled();
  });
});

describe("payout worker — fee calculation", () => {
  it("transfer amount equals fees.sellerPayout not gross amount", async () => {
    await processorRef.fn!(makeJob());

    expect(mockTransferCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 9430 }), // sellerPayout, not 10000
      expect.anything(),
    );
  });

  it("platform fee stored in payout record", async () => {
    await processorRef.fn!(makeJob());

    expect(payoutMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ platformFeeNzd: 350 }),
      }),
    );
  });

  it("stripe fee estimate stored in payout record", async () => {
    await processorRef.fn!(makeJob());

    expect(payoutMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stripeFeeNzd: 220 }),
      }),
    );
  });
});

describe("payout worker — idempotency status check", () => {
  it("skips payout that is already PROCESSING", async () => {
    payoutMock.findUnique.mockResolvedValue({
      id: "payout-123",
      status: "PROCESSING",
      amountNzd: 10000,
      effectiveFeeRateBps: 0,
    });

    const result = await processorRef.fn!(makeJob());

    expect(mockTransferCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: true });
  });
});

// ─── Fee-rate snapshot (D1) ───────────────────────────────────────────────────
// Verifies that the platform-fee rate is pinned at first worker pickup so
// subsequent retries reproduce the identical fees, even if an admin has
// edited PlatformConfig in the intervening 3-business-day window.

describe("payout worker — fee rate snapshot", () => {
  it("first pickup reads live config and persists the rate", async () => {
    // effectiveFeeRateBps === 0 (default mock) → first pickup branch
    await processorRef.fn!(makeJob());

    // calculateFees (live config) must be called on first pickup
    expect(mockCalculateFees).toHaveBeenCalledTimes(1);
    expect(mockCalculateFeesFromBps).not.toHaveBeenCalled();

    // Snapshot must be written BEFORE the Stripe transfer.
    // 0.035 → round(0.035 * 10_000) = 350
    expect(payoutMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: "order-abc" },
        data: { effectiveFeeRateBps: 350 },
      }),
    );

    const snapshotOrder = payoutMock.update.mock.invocationCallOrder.find(
      (_order, idx) =>
        (payoutMock.update.mock.calls[idx]?.[0] as { data?: unknown })?.data &&
        "effectiveFeeRateBps" in
          (payoutMock.update.mock.calls[idx]?.[0] as { data: object }).data,
    );
    const transferOrder = mockTransferCreate.mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeDefined();
    expect(transferOrder).toBeDefined();
    expect(snapshotOrder!).toBeLessThan(transferOrder!);
  });

  it("retry pickup uses snapshot and skips calculateFees", async () => {
    // Simulate a retry: snapshot already exists on the Payout row.
    payoutMock.findUnique.mockResolvedValue({
      id: "payout-123",
      status: "PENDING",
      amountNzd: 10000,
      effectiveFeeRateBps: 350, // 3.5% snapshotted on a previous run
    });
    mockCalculateFeesFromBps.mockReturnValue(DEFAULT_FEES);

    await processorRef.fn!(makeJob());

    // Retry path MUST NOT touch live config — this is the whole point of the snapshot
    expect(mockCalculateFees).not.toHaveBeenCalled();
    expect(mockCalculateFeesFromBps).toHaveBeenCalledWith(10000, 350, null);

    // No second snapshot write on retry — the existing snapshot stays intact
    const snapshotCalls = payoutMock.update.mock.calls.filter(
      (call) =>
        (call[0] as { data?: { effectiveFeeRateBps?: unknown } }).data
          ?.effectiveFeeRateBps !== undefined,
    );
    expect(snapshotCalls).toHaveLength(0);
  });

  it("retry reproduces identical fees after admin rate change", async () => {
    // Snapshot captured 3.5% on first pickup.
    payoutMock.findUnique.mockResolvedValue({
      id: "payout-123",
      status: "PENDING",
      amountNzd: 10000,
      effectiveFeeRateBps: 350,
    });

    // Admin has since raised standard rate to 4.0% — live config would
    // compute platformFee = 400. But the snapshot must win.
    mockCalculateFees.mockResolvedValue({
      ...DEFAULT_FEES,
      platformFee: 400,
      platformFeeRate: 0.04,
      totalFees: 620,
      sellerPayout: 9380,
    });
    mockCalculateFeesFromBps.mockReturnValue(DEFAULT_FEES);

    await processorRef.fn!(makeJob());

    // Transfer amount = snapshot's sellerPayout (9430), not the post-change
    // live-config value (9380). Seller is reimbursed at the original rate.
    expect(mockTransferCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 9430 }),
      expect.anything(),
    );
  });

  it("does not snapshot when payout requires manual review", async () => {
    // A payout with sub-minimum seller payout must flag MANUAL_REVIEW and
    // NOT snapshot the rate — admins may need to adjust config before
    // the payout is reprocessed.
    mockCalculateFees.mockResolvedValue({
      grossAmountCents: 100,
      stripeFee: 32,
      platformFee: 50,
      platformFeeRate: 0.035,
      totalFees: 82,
      sellerPayout: 0,
      tier: "STANDARD" as const,
      requiresManualReview: true,
      manualReviewReason:
        "Fees (82¢) exceed or reduce seller payout below minimum (50¢) — manual review required before transfer.",
    });

    await processorRef.fn!(makeJob());

    // No snapshot written for manual-review payouts
    const snapshotCalls = payoutMock.update.mock.calls.filter(
      (call) =>
        (call[0] as { data?: { effectiveFeeRateBps?: unknown } }).data
          ?.effectiveFeeRateBps !== undefined,
    );
    expect(snapshotCalls).toHaveLength(0);

    // No Stripe transfer attempted
    expect(mockTransferCreate).not.toHaveBeenCalled();
  });
});
