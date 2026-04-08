// src/test/payment-flows.test.ts
// ─── Tests: PaymentService — capture, refund, getClientSecret ──────────────
// Covers: successful capture, already-captured, expired PI, unexpected states,
// full refund, refund failures, and client secret retrieval.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockStripeCapture,
  mockStripeCreate,
  mockStripeRefund,
  mockStripeRetrieve,
} from "./setup";
import { PaymentService } from "@/modules/payments/payment.service";

// ── Mock request-context ─────────────────────────────────────────────────────
vi.mock("@/lib/request-context", () => ({
  getRequestContext: vi
    .fn()
    .mockReturnValue({ correlationId: "corr-test-123" }),
}));

const paymentService = new PaymentService();

// ── Helpers ──────────────────────────────────────────────────────────────────

const validCreateInput = {
  orderId: "order-1",
  amountNzd: 5000,
  sellerStripeAccountId: "acct_1234567890abcdef",
  listingId: "listing-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  listingTitle: "Vintage Lamp",
};

const captureInput = {
  orderId: "order-1",
  paymentIntentId: "pi_mock",
};

const refundInput = {
  orderId: "order-1",
  paymentIntentId: "pi_mock",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PaymentService — createPaymentIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStripeCreate.mockResolvedValue({
      id: "pi_new",
      client_secret: "cs_secret",
      amount: 5000,
    });
  });

  it("creates a payment intent and returns paymentIntentId, clientSecret, amount", async () => {
    const result = await paymentService.createPaymentIntent(validCreateInput);

    expect(result).toEqual({
      paymentIntentId: "pi_new",
      clientSecret: "cs_secret",
      amount: 5000,
    });
    expect(mockStripeCreate).toHaveBeenCalledTimes(1);
    expect(mockStripeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        currency: "nzd",
        capture_method: "manual",
        transfer_data: { destination: "acct_1234567890abcdef" },
      }),
    );
  });

  it("passes idempotency key to Stripe when provided", async () => {
    await paymentService.createPaymentIntent({
      ...validCreateInput,
      idempotencyKey: "idem-key-1",
    });

    expect(mockStripeCreate).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: "pi-idem-key-1",
    });
  });

  it("rejects seller account without acct_ prefix", async () => {
    await expect(
      paymentService.createPaymentIntent({
        ...validCreateInput,
        sellerStripeAccountId: "bad_account_id",
      }),
    ).rejects.toThrow("Seller payment account is not configured");
  });

  it("rejects empty seller account", async () => {
    await expect(
      paymentService.createPaymentIntent({
        ...validCreateInput,
        sellerStripeAccountId: "",
      }),
    ).rejects.toThrow("Seller payment account is not configured");
  });

  it("wraps Stripe creation errors as PAYMENT_GATEWAY_ERROR", async () => {
    mockStripeCreate.mockRejectedValue(new Error("Stripe network error"));

    await expect(
      paymentService.createPaymentIntent(validCreateInput),
    ).rejects.toThrow("Payment setup failed");
  });

  it("includes correlationId in PI metadata", async () => {
    await paymentService.createPaymentIntent(validCreateInput);

    expect(mockStripeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          correlationId: "corr-test-123",
          orderId: "order-1",
          buyerId: "buyer-1",
          sellerId: "seller-1",
        }),
      }),
    );
  });
});

describe("PaymentService — capturePayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStripeCapture.mockResolvedValue({ id: "pi_mock", status: "succeeded" });
  });

  it("captures successfully on first attempt", async () => {
    await paymentService.capturePayment(captureInput);

    expect(mockStripeCapture).toHaveBeenCalledWith("pi_mock");
  });

  it("handles charge_already_captured silently", async () => {
    mockStripeCapture.mockRejectedValue({
      code: "charge_already_captured",
      type: "invalid_request_error",
      message: "This PaymentIntent has already been captured.",
    });

    // Should NOT throw
    await paymentService.capturePayment(captureInput);
  });

  it("handles payment_intent_unexpected_state when PI is succeeded", async () => {
    mockStripeCapture.mockRejectedValue({
      code: "payment_intent_unexpected_state",
      type: "invalid_request_error",
      message: "unexpected state",
    });
    mockStripeRetrieve.mockResolvedValue({
      id: "pi_mock",
      status: "succeeded",
    });

    // PI already captured — should not throw
    await paymentService.capturePayment(captureInput);

    expect(mockStripeRetrieve).toHaveBeenCalledWith("pi_mock");
  });

  it("throws on expired PI (unexpected_state but status is canceled)", async () => {
    mockStripeCapture.mockRejectedValue({
      code: "payment_intent_unexpected_state",
      type: "invalid_request_error",
      message: "unexpected state",
    });
    mockStripeRetrieve.mockResolvedValue({
      id: "pi_mock",
      status: "canceled",
    });

    await expect(paymentService.capturePayment(captureInput)).rejects.toThrow(
      "Payment authorization has expired",
    );
  });

  it("throws on expired PI when status is requires_payment_method", async () => {
    mockStripeCapture.mockRejectedValue({
      code: "payment_intent_unexpected_state",
      type: "invalid_request_error",
      message: "unexpected state",
    });
    mockStripeRetrieve.mockResolvedValue({
      id: "pi_mock",
      status: "requires_payment_method",
    });

    await expect(paymentService.capturePayment(captureInput)).rejects.toThrow(
      "Payment authorization has expired",
    );
  });

  it("throws when retrieve also fails on unexpected_state", async () => {
    mockStripeCapture.mockRejectedValue({
      code: "payment_intent_unexpected_state",
      type: "invalid_request_error",
      message: "unexpected state",
    });
    mockStripeRetrieve.mockRejectedValue(new Error("Stripe down"));

    await expect(paymentService.capturePayment(captureInput)).rejects.toThrow(
      "Payment capture failed",
    );
  });

  it("wraps unknown Stripe errors as PAYMENT_GATEWAY_ERROR", async () => {
    mockStripeCapture.mockRejectedValue(
      new Error("Network timeout connecting to Stripe"),
    );

    await expect(paymentService.capturePayment(captureInput)).rejects.toThrow(
      "Payment capture failed",
    );
  });

  it("detects already-captured via type=invalid_request_error + code contains already", async () => {
    mockStripeCapture.mockRejectedValue({
      code: "already_captured",
      type: "invalid_request_error",
      message: "already captured",
    });

    // Should not throw
    await paymentService.capturePayment(captureInput);
  });
});

describe("PaymentService — refundPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStripeRefund.mockResolvedValue({ id: "re_mock" });
  });

  it("creates a full refund with idempotency key", async () => {
    await paymentService.refundPayment(refundInput);

    expect(mockStripeRefund).toHaveBeenCalledWith(
      { payment_intent: "pi_mock" },
      { idempotencyKey: "refund-order-1" },
    );
  });

  it("scopes idempotency key to orderId — prevents duplicate refunds", async () => {
    await paymentService.refundPayment({
      ...refundInput,
      orderId: "order-xyz",
    });

    expect(mockStripeRefund).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: "refund-order-xyz",
    });
  });

  it("propagates Stripe refund error as PAYMENT_GATEWAY_ERROR", async () => {
    mockStripeRefund.mockRejectedValue(
      new Error("Charge has already been refunded"),
    );

    await expect(paymentService.refundPayment(refundInput)).rejects.toThrow(
      "Refund failed",
    );
  });

  it("handles network failure gracefully", async () => {
    mockStripeRefund.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(paymentService.refundPayment(refundInput)).rejects.toThrow(
      "Refund failed",
    );
  });
});

describe("PaymentService — getClientSecret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retrieves client_secret for existing PI", async () => {
    mockStripeRetrieve.mockResolvedValue({
      id: "pi_mock",
      client_secret: "cs_existing_secret",
    });

    const result = await paymentService.getClientSecret("pi_mock");

    expect(result).toBe("cs_existing_secret");
    expect(mockStripeRetrieve).toHaveBeenCalledWith("pi_mock");
  });

  it("returns null when retrieve fails", async () => {
    mockStripeRetrieve.mockRejectedValue(new Error("PI not found"));

    const result = await paymentService.getClientSecret("pi_nonexistent");

    expect(result).toBeNull();
  });

  it("returns null when client_secret is undefined", async () => {
    mockStripeRetrieve.mockResolvedValue({
      id: "pi_mock",
      client_secret: undefined,
    });

    const result = await paymentService.getClientSecret("pi_mock");

    expect(result).toBeNull();
  });
});
