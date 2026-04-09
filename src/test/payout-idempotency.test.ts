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
}));

// ── Mock Stripe client ────────────────────────────────────────────────────────

const mockTransferCreate = vi.fn();

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
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

vi.mock("@/modules/payments/fee-calculator", () => ({
  calculateFees: (...args: unknown[]) => mockCalculateFees(...args),
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
  it("acquires lock before initiating transfer", async () => {
    const { acquireLock } = await import("@/server/lib/distributedLock");

    await processorRef.fn!(makeJob());

    const acquireOrder =
      vi.mocked(acquireLock).mock.invocationCallOrder[0] ?? 0;
    const transferOrder =
      mockTransferCreate.mock.invocationCallOrder[0] ?? Infinity;
    expect(acquireOrder).toBeLessThan(transferOrder);
  });

  it("releases lock after transfer completes", async () => {
    const { releaseLock } = await import("@/server/lib/distributedLock");

    await processorRef.fn!(makeJob());

    expect(vi.mocked(releaseLock)).toHaveBeenCalledWith(
      "payout:order-abc",
      expect.any(String),
    );
  });

  it("lock failure returns without creating transfer", async () => {
    const { acquireLock } = await import("@/server/lib/distributedLock");
    vi.mocked(acquireLock).mockResolvedValueOnce(null);

    await processorRef.fn!(makeJob());

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
    });

    const result = await processorRef.fn!(makeJob());

    expect(mockTransferCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: true });
  });
});
