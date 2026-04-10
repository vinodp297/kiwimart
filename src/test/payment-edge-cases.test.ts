// src/test/payment-edge-cases.test.ts
// ─── Tests for PaymentService edge cases ────────────────────────────────────
// Covers: getClientSecret, capture unexpected_state paths, idempotency,
// and Stripe failure scenarios (timeout, rate limit, authorization expired).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockStripeCreate,
  mockStripeCapture,
  mockStripeRefund,
  mockStripeRetrieve,
} from "./setup";
import { paymentService } from "@/modules/payments/payment.service";
import { AppError } from "@/shared/errors";

describe("PaymentService — edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getClientSecret ────────────────────────────────────────────────────────

  describe("getClientSecret", () => {
    it("returns client_secret on success", async () => {
      mockStripeRetrieve.mockResolvedValueOnce({
        id: "pi_existing",
        client_secret: "cs_existing_secret",
        status: "requires_capture",
      });

      const secret = await paymentService.getClientSecret("pi_existing");

      expect(secret).toBe("cs_existing_secret");
      expect(mockStripeRetrieve).toHaveBeenCalledWith("pi_existing");
    });

    it("returns null when client_secret is undefined", async () => {
      mockStripeRetrieve.mockResolvedValueOnce({
        id: "pi_no_secret",
        client_secret: undefined,
        status: "canceled",
      });

      const secret = await paymentService.getClientSecret("pi_no_secret");

      expect(secret).toBeNull();
    });

    it("returns null on network error (fail-silent)", async () => {
      mockStripeRetrieve.mockRejectedValueOnce(new Error("ECONNRESET"));

      const secret = await paymentService.getClientSecret("pi_timeout");

      expect(secret).toBeNull();
    });

    it("returns null on Stripe rate limit (fail-silent)", async () => {
      const rateLimitErr = Object.assign(new Error("Rate limit"), {
        code: "rate_limit",
        type: "invalid_request_error",
        statusCode: 429,
      });
      mockStripeRetrieve.mockRejectedValueOnce(rateLimitErr);

      const secret = await paymentService.getClientSecret("pi_429");

      expect(secret).toBeNull();
    });
  });

  // ── createPaymentIntent — idempotency ──────────────────────────────────────

  describe("createPaymentIntent — idempotency", () => {
    const baseInput = {
      amountNzd: 5000,
      sellerId: "seller-1",
      sellerStripeAccountId: "acct_1234567890abcdef",
      orderId: "order-1",
      listingId: "listing-1",
      listingTitle: "Test Item",
      buyerId: "buyer-1",
    };

    it("passes idempotencyKey to Stripe when provided", async () => {
      mockStripeCreate.mockResolvedValueOnce({
        id: "pi_idempotent",
        client_secret: "cs_idem",
        amount: 5000,
      });

      await paymentService.createPaymentIntent({
        ...baseInput,
        idempotencyKey: "checkout_abc123",
      });

      expect(mockStripeCreate).toHaveBeenCalledWith(expect.any(Object), {
        idempotencyKey: "pi-checkout_abc123",
      });
    });

    it("omits idempotencyKey when not provided", async () => {
      mockStripeCreate.mockResolvedValueOnce({
        id: "pi_no_idem",
        client_secret: "cs_no_idem",
        amount: 5000,
      });

      await paymentService.createPaymentIntent(baseInput);

      // Called with a single argument (intentData), no options object
      expect(mockStripeCreate).toHaveBeenCalledWith(expect.any(Object));
      expect(mockStripeCreate).not.toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      );
    });

    it("includes custom metadata when provided", async () => {
      mockStripeCreate.mockResolvedValueOnce({
        id: "pi_meta",
        client_secret: "cs_meta",
        amount: 5000,
      });

      await paymentService.createPaymentIntent({
        ...baseInput,
        metadata: { campaign: "summer_sale" },
      });

      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            orderId: "order-1",
            campaign: "summer_sale",
          }),
        }),
      );
    });

    it("wraps Stripe rate-limit error as AppError", async () => {
      const rateLimitErr = Object.assign(new Error("Rate limit exceeded"), {
        statusCode: 429,
        type: "rate_limit_error",
      });
      mockStripeCreate.mockRejectedValueOnce(rateLimitErr);

      await expect(
        paymentService.createPaymentIntent(baseInput),
      ).rejects.toThrow(AppError);
    });
  });

  // ── capturePayment — unexpected_state paths ────────────────────────────────

  describe("capturePayment — unexpected_state resolution", () => {
    const captureInput = {
      paymentIntentId: "pi_unexpected",
      orderId: "order-1",
    };

    it("throws when PI status is requires_payment_method (authorization expired)", async () => {
      // First capture attempt: unexpected_state
      const unexpectedErr = Object.assign(new Error("unexpected state"), {
        code: "payment_intent_unexpected_state",
        type: "invalid_request_error",
      });
      mockStripeCapture.mockRejectedValueOnce(unexpectedErr);

      // Retrieve shows the PI authorization expired
      mockStripeRetrieve.mockResolvedValueOnce({
        id: "pi_unexpected",
        status: "requires_payment_method",
      });

      await expect(paymentService.capturePayment(captureInput)).rejects.toThrow(
        "Payment authorization has expired",
      );
    });

    it("throws when PI status is canceled", async () => {
      const unexpectedErr = Object.assign(new Error("unexpected state"), {
        code: "payment_intent_unexpected_state",
        type: "invalid_request_error",
      });
      mockStripeCapture.mockRejectedValueOnce(unexpectedErr);

      mockStripeRetrieve.mockResolvedValueOnce({
        id: "pi_unexpected",
        status: "canceled",
      });

      await expect(paymentService.capturePayment(captureInput)).rejects.toThrow(
        "Payment authorization has expired",
      );
    });

    it("re-throws AppError from retrieve failure", async () => {
      const unexpectedErr = Object.assign(new Error("unexpected state"), {
        code: "payment_intent_unexpected_state",
        type: "invalid_request_error",
      });
      mockStripeCapture.mockRejectedValueOnce(unexpectedErr);

      // Retrieve throws the AppError from the first throw (authorization expired)
      // simulating a re-entrant call
      mockStripeRetrieve.mockRejectedValueOnce(
        AppError.paymentGatewayError("Payment authorization has expired."),
      );

      await expect(paymentService.capturePayment(captureInput)).rejects.toThrow(
        AppError,
      );
    });

    it("throws generic capture error when retrieve itself fails with network error", async () => {
      const unexpectedErr = Object.assign(new Error("unexpected state"), {
        code: "payment_intent_unexpected_state",
        type: "invalid_request_error",
      });
      mockStripeCapture.mockRejectedValueOnce(unexpectedErr);

      // Retrieve itself fails with a network error
      mockStripeRetrieve.mockRejectedValueOnce(new Error("ECONNRESET"));

      await expect(paymentService.capturePayment(captureInput)).rejects.toThrow(
        "Payment capture failed",
      );
    });

    it("handles invalid_request_error with already-like code", async () => {
      // Variant: type=invalid_request_error, code contains "already"
      const alreadyErr = Object.assign(new Error("charge already captured"), {
        code: "already_captured",
        type: "invalid_request_error",
      });
      mockStripeCapture.mockRejectedValueOnce(alreadyErr);

      await expect(
        paymentService.capturePayment(captureInput),
      ).resolves.toBeUndefined();
    });
  });

  // ── capturePayment — generic errors ────────────────────────────────────────

  describe("capturePayment — generic error handling", () => {
    it("throws AppError when capture fails with non-Error object", async () => {
      // Some Stripe libraries throw plain strings in edge cases
      mockStripeCapture.mockRejectedValueOnce("unexpected_string_error");

      await expect(
        paymentService.capturePayment({
          paymentIntentId: "pi_string_err",
          orderId: "order-1",
        }),
      ).rejects.toThrow(AppError);
    });

    it("throws AppError when capture fails with error lacking code/type", async () => {
      mockStripeCapture.mockRejectedValueOnce(
        new Error("Something went wrong"),
      );

      await expect(
        paymentService.capturePayment({
          paymentIntentId: "pi_generic",
          orderId: "order-1",
        }),
      ).rejects.toThrow("Payment capture failed");
    });
  });

  // ── refundPayment — edge cases ─────────────────────────────────────────────

  describe("refundPayment — idempotency", () => {
    it("uses orderId-scoped idempotency key", async () => {
      mockStripeRefund.mockResolvedValueOnce({ id: "re_idem" });

      await paymentService.refundPayment({
        paymentIntentId: "pi_refund",
        orderId: "order-unique-42",
      });

      expect(mockStripeRefund).toHaveBeenCalledWith(
        { payment_intent: "pi_refund" },
        { idempotencyKey: "refund-order-unique-42-full-no-reason" },
      );
    });

    it("wraps non-Error throw as AppError", async () => {
      mockStripeRefund.mockRejectedValueOnce({ raw: "stripe_internal" });

      await expect(
        paymentService.refundPayment({
          paymentIntentId: "pi_weird",
          orderId: "order-1",
        }),
      ).rejects.toThrow(AppError);
    });
  });
});
