// src/test/refund-idempotency-key.test.ts
// ─── Fix 4 tests: refund idempotency key includes amount + reason ─────────────
// Verifies that stripe.refunds.create is called with an idempotency key that
// encodes orderId, amount, and reason — preventing partial-refund silent failures
// where a different-amount refund is incorrectly deduplicated by Stripe.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── Capture idempotency keys sent to Stripe ───────────────────────────────────

const mockRefundsCreate = vi.fn().mockResolvedValue({ id: "re_test" });

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    refunds: {
      create: (...a: unknown[]) => mockRefundsCreate(...a),
    },
  },
}));

vi.mock("@/lib/request-context", () => ({
  getRequestContext: vi.fn().mockReturnValue(null),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Fix 4 — refund idempotency key includes amount and reason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefundsCreate.mockResolvedValue({ id: "re_test" });
  });

  it("key is refund-{orderId}-{amountNzd}-{reason} when both are provided", async () => {
    const { paymentService } =
      await import("@/modules/payments/payment.service");

    await paymentService.refundPayment({
      paymentIntentId: "pi_abc",
      orderId: "ord-1",
      amountNzd: 5000,
      reason: "BUYER_WON",
    });

    const [, opts] = mockRefundsCreate.mock.calls[0] as [
      unknown,
      { idempotencyKey: string },
    ];
    expect(opts.idempotencyKey).toBe("refund-ord-1-5000-BUYER_WON");
  });

  it("key falls back to 'full' when amountNzd is omitted", async () => {
    const { paymentService } =
      await import("@/modules/payments/payment.service");

    await paymentService.refundPayment({
      paymentIntentId: "pi_abc",
      orderId: "ord-2",
    });

    const [, opts] = mockRefundsCreate.mock.calls[0] as [
      unknown,
      { idempotencyKey: string },
    ];
    expect(opts.idempotencyKey).toBe("refund-ord-2-full-no-reason");
  });

  it("two refunds for same order with different amounts produce different keys", async () => {
    const { paymentService } =
      await import("@/modules/payments/payment.service");

    await paymentService.refundPayment({
      paymentIntentId: "pi_abc",
      orderId: "ord-3",
      amountNzd: 2500,
      reason: "PARTIAL",
    });
    await paymentService.refundPayment({
      paymentIntentId: "pi_abc",
      orderId: "ord-3",
      amountNzd: 5000,
      reason: "PARTIAL",
    });

    const key1 = (
      mockRefundsCreate.mock.calls[0] as [unknown, { idempotencyKey: string }]
    )[1].idempotencyKey;
    const key2 = (
      mockRefundsCreate.mock.calls[1] as [unknown, { idempotencyKey: string }]
    )[1].idempotencyKey;

    expect(key1).toBe("refund-ord-3-2500-PARTIAL");
    expect(key2).toBe("refund-ord-3-5000-PARTIAL");
    expect(key1).not.toBe(key2);
  });

  it("two refunds for same order with different reasons produce different keys", async () => {
    const { paymentService } =
      await import("@/modules/payments/payment.service");

    await paymentService.refundPayment({
      paymentIntentId: "pi_abc",
      orderId: "ord-4",
      amountNzd: 5000,
      reason: "BUYER_WON",
    });
    await paymentService.refundPayment({
      paymentIntentId: "pi_abc",
      orderId: "ord-4",
      amountNzd: 5000,
      reason: "DISPUTE_SETTLED",
    });

    const key1 = (
      mockRefundsCreate.mock.calls[0] as [unknown, { idempotencyKey: string }]
    )[1].idempotencyKey;
    const key2 = (
      mockRefundsCreate.mock.calls[1] as [unknown, { idempotencyKey: string }]
    )[1].idempotencyKey;

    expect(key1).toBe("refund-ord-4-5000-BUYER_WON");
    expect(key2).toBe("refund-ord-4-5000-DISPUTE_SETTLED");
    expect(key1).not.toBe(key2);
  });
});
