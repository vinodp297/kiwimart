// src/test/payment.service.test.ts
// ─── Tests for PaymentService ─────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStripeCreate, mockStripeCapture, mockStripeRefund } from "./setup";
import { paymentService } from "@/modules/payments/payment.service";

describe("PaymentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createPaymentIntent ───────────────────────────────────────────────────

  describe("createPaymentIntent", () => {
    it("creates payment intent with valid input", async () => {
      mockStripeCreate.mockResolvedValueOnce({
        id: "pi_test_123",
        client_secret: "cs_test_secret",
        amount: 5000,
      });

      const result = await paymentService.createPaymentIntent({
        amountNzd: 5000,
        sellerId: "seller-1",
        sellerStripeAccountId: "acct_1234567890abcdef",
        orderId: "order-1",
        listingId: "listing-1",
        listingTitle: "Test Item",
        buyerId: "buyer-1",
      });

      expect(result.paymentIntentId).toBe("pi_test_123");
      expect(result.clientSecret).toBe("cs_test_secret");
      expect(result.amount).toBe(5000);
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          currency: "nzd",
          capture_method: "manual",
        }),
      );
    });

    it("throws on invalid Connect account", async () => {
      await expect(
        paymentService.createPaymentIntent({
          amountNzd: 5000,
          sellerId: "seller-1",
          sellerStripeAccountId: "invalid_account",
          orderId: "order-1",
          listingId: "listing-1",
          listingTitle: "Test Item",
          buyerId: "buyer-1",
        }),
      ).rejects.toThrow("Seller payment account is not configured");
    });

    it("throws on empty Connect account", async () => {
      await expect(
        paymentService.createPaymentIntent({
          amountNzd: 5000,
          sellerId: "seller-1",
          sellerStripeAccountId: "",
          orderId: "order-1",
          listingId: "listing-1",
          listingTitle: "Test Item",
          buyerId: "buyer-1",
        }),
      ).rejects.toThrow("Seller payment account is not configured");
    });

    it("throws AppError on Stripe failure", async () => {
      mockStripeCreate.mockRejectedValueOnce(new Error("card_declined"));

      await expect(
        paymentService.createPaymentIntent({
          amountNzd: 5000,
          sellerId: "seller-1",
          sellerStripeAccountId: "acct_1234567890abcdef",
          orderId: "order-1",
          listingId: "listing-1",
          listingTitle: "Test Item",
          buyerId: "buyer-1",
        }),
      ).rejects.toThrow("Payment setup failed");
    });
  });

  // ── capturePayment ────────────────────────────────────────────────────────

  describe("capturePayment", () => {
    it("captures payment successfully", async () => {
      mockStripeCapture.mockResolvedValueOnce({
        id: "pi_captured",
        status: "succeeded",
      });

      await expect(
        paymentService.capturePayment({
          paymentIntentId: "pi_captured",
          orderId: "order-1",
        }),
      ).resolves.toBeUndefined();

      expect(mockStripeCapture).toHaveBeenCalledWith("pi_captured");
    });

    it("handles already_captured gracefully", async () => {
      // Stripe errors have .code and .type properties
      const stripeErr = Object.assign(new Error("already_captured"), {
        code: "charge_already_captured",
        type: "invalid_request_error",
      });
      mockStripeCapture.mockRejectedValueOnce(stripeErr);

      await expect(
        paymentService.capturePayment({
          paymentIntentId: "pi_already",
          orderId: "order-1",
        }),
      ).resolves.toBeUndefined();
    });

    it("handles amount_capturable gracefully", async () => {
      const stripeErr = Object.assign(new Error("amount_capturable is zero"), {
        code: "payment_intent_unexpected_state",
        type: "invalid_request_error",
      });
      mockStripeCapture.mockRejectedValueOnce(stripeErr);

      await expect(
        paymentService.capturePayment({
          paymentIntentId: "pi_zero",
          orderId: "order-1",
        }),
      ).resolves.toBeUndefined();
    });

    it("throws on actual Stripe error", async () => {
      mockStripeCapture.mockRejectedValueOnce(new Error("network_error"));

      await expect(
        paymentService.capturePayment({
          paymentIntentId: "pi_fail",
          orderId: "order-1",
        }),
      ).rejects.toThrow("Payment capture failed");
    });
  });

  // ── refundPayment ─────────────────────────────────────────────────────────

  describe("refundPayment", () => {
    it("refunds payment successfully", async () => {
      mockStripeRefund.mockResolvedValueOnce({ id: "re_test" });

      await expect(
        paymentService.refundPayment({
          paymentIntentId: "pi_to_refund",
          orderId: "order-1",
        }),
      ).resolves.toBeUndefined();

      expect(mockStripeRefund).toHaveBeenCalledWith(
        { payment_intent: "pi_to_refund" },
        { idempotencyKey: "refund-order-1-full-no-reason" },
      );
    });

    it("throws AppError on refund failure", async () => {
      mockStripeRefund.mockRejectedValueOnce(new Error("refund_declined"));

      await expect(
        paymentService.refundPayment({
          paymentIntentId: "pi_fail_refund",
          orderId: "order-1",
        }),
      ).rejects.toThrow("Refund failed");
    });
  });
});
