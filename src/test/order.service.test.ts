// src/test/order.service.test.ts
// ─── Tests for OrderService + createOrder server action ──────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStripeCapture, mockStripeCreate } from "./setup";
import { orderService } from "@/modules/orders/order.service";
import { createOrder } from "@/server/actions/orders";
import db from "@/lib/db";

vi.mock("@/server/lib/requireUser", () => ({
  requireUser: vi.fn().mockResolvedValue({
    id: "buyer-1",
    email: "buyer@test.com",
    isAdmin: false,
    isBanned: false,
    isSellerEnabled: false,
    isStripeOnboarded: false,
  }),
}));

describe("OrderService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("confirmDelivery", () => {
    it("succeeds for valid dispatched order", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: "order-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "listing-1",
        status: "DISPATCHED",
        stripePaymentIntentId: "pi_test",
        totalNzd: 5000,
      } as never);

      mockStripeCapture.mockResolvedValueOnce({
        id: "pi_test",
        status: "succeeded",
      });
      vi.mocked(db.$transaction).mockResolvedValue([] as never);
      vi.mocked(db.user.findUnique).mockResolvedValue({
        stripeAccountId: "acct_test123456789",
      } as never);

      await expect(
        orderService.confirmDelivery("order-1", "buyer-1"),
      ).resolves.toBeUndefined();

      expect(mockStripeCapture).toHaveBeenCalledWith("pi_test");
      expect(db.$transaction).toHaveBeenCalled();
    });

    it("throws for null payment intent", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: "order-no-pi",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "listing-1",
        status: "DISPATCHED",
        stripePaymentIntentId: null,
        totalNzd: 5000,
      } as never);

      await expect(
        orderService.confirmDelivery("order-no-pi", "buyer-1"),
      ).rejects.toThrow("Payment reference missing");
    });

    it("throws for wrong buyer", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: "order-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "listing-1",
        status: "DISPATCHED",
        stripePaymentIntentId: "pi_test",
        totalNzd: 5000,
      } as never);

      await expect(
        orderService.confirmDelivery("order-1", "wrong-buyer"),
      ).rejects.toThrow("Only the buyer can confirm delivery");
    });

    it("throws for wrong order status", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: "order-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "listing-1",
        status: "PAYMENT_HELD",
        stripePaymentIntentId: "pi_test",
        totalNzd: 5000,
      } as never);

      await expect(
        orderService.confirmDelivery("order-1", "buyer-1"),
      ).rejects.toThrow("not in a deliverable state");
    });

    it("throws for non-existent order", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(null as never);

      await expect(
        orderService.confirmDelivery("order-missing", "buyer-1"),
      ).rejects.toThrow("Order not found");
    });

    it("does not update DB if Stripe capture fails", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: "order-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "listing-1",
        status: "DISPATCHED",
        stripePaymentIntentId: "pi_fail",
        totalNzd: 5000,
      } as never);

      mockStripeCapture.mockRejectedValueOnce(new Error("charge_expired"));

      await expect(
        orderService.confirmDelivery("order-1", "buyer-1"),
      ).rejects.toThrow();

      expect(db.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("markDispatched", () => {
    it("succeeds for valid order", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: "order-1",
        sellerId: "seller-1",
        status: "PAYMENT_HELD",
        buyerId: "buyer-1",
        listing: { title: "Test Item" },
        buyer: { email: "buyer@test.com", displayName: "Buyer" },
      } as never);

      vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 } as never);

      await expect(
        orderService.markDispatched(
          {
            orderId: "order-1",
            trackingNumber: "123ABC",
            courier: "NZ Post",
            estimatedDeliveryDate: new Date(Date.now() + 3 * 86400000)
              .toISOString()
              .split("T")[0]!,
            dispatchPhotos: ["dispatch/seller-1/photo1.jpg"],
          },
          "seller-1",
        ),
      ).resolves.toBeUndefined();

      expect(db.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "order-1",
            status: "PAYMENT_HELD",
          }),
          data: expect.objectContaining({ status: "DISPATCHED" }),
        }),
      );
    });

    it("throws for wrong seller", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: "order-1",
        sellerId: "seller-1",
        status: "PAYMENT_HELD",
        buyerId: "buyer-1",
        listing: { title: "Test" },
        buyer: { email: "b@t.com", displayName: "B" },
      } as never);

      await expect(
        orderService.markDispatched(
          {
            orderId: "order-1",
            trackingNumber: "123",
            courier: "NZ Post",
            estimatedDeliveryDate: new Date(Date.now() + 3 * 86400000)
              .toISOString()
              .split("T")[0]!,
            dispatchPhotos: ["dispatch/wrong/p.jpg"],
          },
          "wrong-seller",
        ),
      ).rejects.toThrow("Only the seller");
    });

    it("throws for wrong status", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: "order-1",
        sellerId: "seller-1",
        status: "DISPATCHED",
        buyerId: "buyer-1",
        listing: { title: "Test" },
        buyer: { email: "b@t.com", displayName: "B" },
      } as never);

      await expect(
        orderService.markDispatched(
          {
            orderId: "order-1",
            trackingNumber: "123",
            courier: "NZ Post",
            estimatedDeliveryDate: new Date(Date.now() + 3 * 86400000)
              .toISOString()
              .split("T")[0]!,
            dispatchPhotos: ["dispatch/seller-1/p.jpg"],
          },
          "seller-1",
        ),
      ).rejects.toThrow("PAYMENT_HELD");
    });
  });

  describe("createOrder — race condition", () => {
    const validListing = {
      id: "listing-1",
      title: "Test Item",
      priceNzd: 5000,
      shippingNzd: 500,
      shippingOption: "COURIER",
      sellerId: "seller-1",
      seller: {
        stripeAccountId: "acct_1234567890123456",
        isStripeOnboarded: true,
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("prevents double-buy: rejects when listing is already reserved", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(validListing as never);
      // Simulate losing the reservation race — another buyer got there first
      vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 0 } as never);

      const result = await createOrder({ listingId: "listing-1" });

      expect(result).toEqual({
        success: false,
        error: "This listing is no longer available.",
      });
      // Must never create an order or touch Stripe when reservation fails
      expect(db.order.create).not.toHaveBeenCalled();
      expect(mockStripeCreate).not.toHaveBeenCalled();
    });

    it("releases listing reservation if Stripe PaymentIntent creation fails", async () => {
      vi.mocked(db.listing.findUnique).mockResolvedValue(validListing as never);
      // Reservation succeeds
      vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(db.order.create).mockResolvedValue({ id: "order-1" } as never);
      // Stripe fails
      mockStripeCreate.mockRejectedValueOnce(new Error("stripe_error"));
      vi.mocked(db.order.update).mockResolvedValue({} as never);

      const result = await createOrder({ listingId: "listing-1" });

      expect(result).toEqual({
        success: false,
        error: "Payment setup failed. Please try again.",
      });
      // Reservation was acquired then released — release call passes
      // status: ACTIVE and clears reservedUntil (Fix 10).
      expect(db.listing.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "RESERVED" }),
          data: { status: "ACTIVE", reservedUntil: null },
        }),
      );
    });
  });
});
