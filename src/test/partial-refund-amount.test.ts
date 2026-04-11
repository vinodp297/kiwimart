// src/test/partial-refund-amount.test.ts
// ─── Tests: E-1 fix — partial refund amount passed to Stripe ─────────────────
// Verifies that:
//   1. stripe.refunds.create is called WITH amount when amountNzd is provided
//   2. stripe.refunds.create is called WITHOUT amount when amountNzd is omitted
//   3. Admin partial-refund call site passes amountNzd to Stripe
//   4. Stripe receives the correct value in cents (not dollars)
//   5. Full refund (no amountNzd) still works correctly

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// All vi.mock factories are hoisted — references must come from vi.hoisted().

const {
  mockRefundsCreate,
  mockPaymentIntentsCapture,
  mockLoggerInfo,
  mockLoggerError,
  // Admin service dependency mocks
  mockFindWithDisputeContext,
  mockTransaction,
  mockTransitionOrder,
  mockResolveDispute,
  mockGetDisputeByOrderId,
  mockWithLock,
} = vi.hoisted(() => ({
  mockRefundsCreate: vi.fn(),
  mockPaymentIntentsCapture: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
  mockFindWithDisputeContext: vi.fn(),
  mockTransaction: vi
    .fn()
    .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({}),
    ),
  mockTransitionOrder: vi.fn().mockResolvedValue(undefined),
  mockResolveDispute: vi.fn().mockResolvedValue(undefined),
  mockGetDisputeByOrderId: vi.fn(),
  mockWithLock: vi
    .fn()
    .mockImplementation(async (_key: string, fn: () => Promise<unknown>) =>
      fn(),
    ),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    refunds: { create: (...args: unknown[]) => mockRefundsCreate(...args) },
    paymentIntents: {
      capture: (...args: unknown[]) => mockPaymentIntentsCapture(...args),
      retrieve: vi.fn(),
      create: vi.fn(),
    },
    transfers: { create: vi.fn() },
  },
}));

vi.mock("@/infrastructure/stripe/with-timeout", () => ({
  withStripeTimeout: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/shared/logger", () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

vi.mock("@/lib/request-context", () => ({
  getRequestContext: () => null,
}));

// Admin service dependencies
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findWithDisputeContext: (...a: unknown[]) =>
      mockFindWithDisputeContext(...a),
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: (...a: unknown[]) => mockTransitionOrder(...a),
}));

vi.mock("@/server/services/dispute/dispute.service", () => ({
  getDisputeByOrderId: (...a: unknown[]) => mockGetDisputeByOrderId(...a),
  resolveDispute: (...a: unknown[]) => mockResolveDispute(...a),
  setAutoResolving: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/lib/distributedLock", () => ({
  withLock: (...a: unknown[]) => mockWithLock(...(a as never)),
  withLockAndHeartbeat: (...a: unknown[]) => mockWithLock(...(a as never)),
  acquireLock: vi.fn().mockResolvedValue("mock-lock"),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: { DISPUTE_RESOLVED: "DISPUTE_RESOLVED" },
  ACTOR_ROLES: { ADMIN: "ADMIN" },
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

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findManyEmailContactsByIds: vi.fn().mockResolvedValue([]),
  },
}));

// ── Imports under test ────────────────────────────────────────────────────────

import { PaymentService } from "@/modules/payments/payment.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService() {
  return new PaymentService();
}

function baseRefundInput() {
  return {
    paymentIntentId: "pi_test_123",
    orderId: "ord_test_456",
  };
}

const mockOrder = {
  id: "ord-1",
  status: "DISPUTED",
  stripePaymentIntentId: "pi_test_123",
  totalNzd: 10000,
  buyerId: "buyer-1",
  sellerId: "seller-1",
  listing: { id: "lst-1", title: "Test Item" },
};

const mockDispute = {
  id: "disp-1",
  orderId: "ord-1",
  status: "OPEN",
};

// ── Tests: PaymentService.refundPayment() ─────────────────────────────────────

describe("PaymentService.refundPayment — partial amount forwarded to Stripe", () => {
  beforeEach(() => {
    mockRefundsCreate.mockReset();
    mockRefundsCreate.mockResolvedValue({ id: "re_test" });
    mockLoggerInfo.mockReset();
    mockLoggerError.mockReset();
  });

  it("passes amount to stripe.refunds.create when amountNzd is provided", async () => {
    const svc = makeService();

    await svc.refundPayment({
      ...baseRefundInput(),
      amountNzd: 4000, // $40.00 NZD in cents
    });

    expect(mockRefundsCreate).toHaveBeenCalledOnce();
    const [body] = mockRefundsCreate.mock.calls[0] as [
      { payment_intent: string; amount?: number },
      unknown,
    ];
    expect(body.amount).toBe(4000);
    expect(body.payment_intent).toBe("pi_test_123");
  });

  it("omits amount from stripe.refunds.create when amountNzd is not provided (full refund)", async () => {
    const svc = makeService();

    await svc.refundPayment({
      ...baseRefundInput(),
      // no amountNzd — should be a full refund
    });

    expect(mockRefundsCreate).toHaveBeenCalledOnce();
    const [body] = mockRefundsCreate.mock.calls[0] as [
      { payment_intent: string; amount?: number },
      unknown,
    ];
    // amount must NOT be present — Stripe defaults to full refund when omitted
    expect("amount" in body).toBe(false);
  });

  it("omits amount when amountNzd is explicitly undefined", async () => {
    const svc = makeService();

    await svc.refundPayment({
      ...baseRefundInput(),
      amountNzd: undefined,
    });

    const [body] = mockRefundsCreate.mock.calls[0] as [
      { payment_intent: string; amount?: number },
      unknown,
    ];
    expect("amount" in body).toBe(false);
  });

  it("passes the exact cent amount — not converted to dollars", async () => {
    const svc = makeService();

    // $10.00 NZD = 1000 cents; Stripe always uses cents
    await svc.refundPayment({
      ...baseRefundInput(),
      amountNzd: 1000,
    });

    const [body] = mockRefundsCreate.mock.calls[0] as [
      { payment_intent: string; amount?: number },
      unknown,
    ];
    expect(body.amount).toBe(1000); // must be 1000, NOT 10
  });

  it("full refund (no amountNzd) still completes successfully", async () => {
    const svc = makeService();

    await expect(
      svc.refundPayment({ ...baseRefundInput() }),
    ).resolves.toBeUndefined();

    expect(mockRefundsCreate).toHaveBeenCalledOnce();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "payment.refunded",
      expect.objectContaining({ orderId: "ord_test_456" }),
    );
  });

  it("idempotency key includes amount string for partial refund", async () => {
    const svc = makeService();

    await svc.refundPayment({
      ...baseRefundInput(),
      amountNzd: 2500,
      reason: "damaged",
    });

    const [, options] = mockRefundsCreate.mock.calls[0] as [
      unknown,
      { idempotencyKey: string },
    ];
    // Key must encode the amount so two different partial refunds are distinct
    expect(options.idempotencyKey).toContain("2500");
    expect(options.idempotencyKey).toContain("damaged");
    expect(options.idempotencyKey).toContain("ord_test_456");
  });
});

// ── Tests: admin partial refund call-site (resolveDisputePartialRefund) ───────

describe("Admin partial refund — call site passes amountNzd to Stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefundsCreate.mockResolvedValue({ id: "re_admin_test" });
    mockPaymentIntentsCapture.mockResolvedValue({
      id: "pi_test_123",
      status: "succeeded",
    });
    mockFindWithDisputeContext.mockResolvedValue(mockOrder);
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute);
    mockTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
    mockWithLock.mockImplementation(
      async (_key: string, fn: () => Promise<unknown>) => fn(),
    );
  });

  it("admin partial refund passes amountNzd (cents) to Stripe refund", async () => {
    const { adminService } = await import("@/modules/admin/admin.service");

    await adminService.resolveDisputePartialRefund(
      "ord-1",
      4000, // $40.00 NZD in cents — partial refund of $100 order
      "Item partially damaged",
      "admin-user-1",
    );

    expect(mockRefundsCreate).toHaveBeenCalledOnce();
    const [body] = mockRefundsCreate.mock.calls[0] as [
      { payment_intent: string; amount?: number },
      unknown,
    ];
    // Must be exactly 4000 cents — NOT the full order total of 10000
    expect(body.amount).toBe(4000);
    expect(body.payment_intent).toBe("pi_test_123");
  });

  it("admin partial refund captures remaining amount after refund", async () => {
    const { adminService } = await import("@/modules/admin/admin.service");

    await adminService.resolveDisputePartialRefund(
      "ord-1",
      4000,
      "Partial damage",
      "admin-user-1",
    );

    // capturePayment must be called after refund to release the remaining
    // balance to the seller
    expect(mockPaymentIntentsCapture).toHaveBeenCalledWith("pi_test_123");
  });

  it("admin partial refund throws and logs ERROR when capture fails", async () => {
    const { adminService } = await import("@/modules/admin/admin.service");

    mockPaymentIntentsCapture.mockRejectedValue(
      new Error("Capture failed: PI already cancelled"),
    );

    await expect(
      adminService.resolveDisputePartialRefund(
        "ord-1",
        4000,
        "Partial damage",
        "admin-user-1",
      ),
    ).rejects.toThrow("Payment capture failed");

    // Must log at ERROR level — capture failure after refund is a financial
    // integrity gap that requires human intervention
    expect(mockLoggerError).toHaveBeenCalledWith(
      "admin.partial_refund.capture_failed",
      expect.objectContaining({ orderId: "ord-1" }),
    );
  });
});
