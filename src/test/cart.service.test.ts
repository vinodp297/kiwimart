// src/test/cart.service.test.ts
// ─── Tests for CartService ─────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock cart repository ───────────────────────────────────────────────────
vi.mock("@/modules/cart/cart.repository", () => ({
  cartRepository: {
    findListingForCart: vi.fn(),
    findByUser: vi.fn(),
    findByUserForDisplay: vi.fn(),
    findByUserForCheckout: vi.fn(),
    findByUserCount: vi.fn(),
    findByUserWithItems: vi.fn(),
    createCart: vi.fn(),
    addItemToCart: vi.fn(),
    deleteCart: vi.fn(),
    deleteCartByUser: vi.fn(),
    removeItemAndExtendExpiry: vi.fn(),
    findIdempotentOrder: vi.fn(),
    reserveListings: vi.fn(),
    releaseListings: vi.fn(),
    createOrder: vi.fn(),
    updateOrderStripePI: vi.fn(),
    findOrderStripePI: vi.fn(),
    findBuyerDisplayName: vi.fn(),
    $transaction: vi.fn(),
  },
}));

// ── Mock services used by cart ─────────────────────────────────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    createPaymentIntent: vi.fn().mockResolvedValue({
      paymentIntentId: "pi_test_123",
      clientSecret: "cs_test_secret",
    }),
    getClientSecret: vi.fn().mockResolvedValue("cs_test_secret"),
  },
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: { ORDER_CREATED: "ORDER_CREATED", CANCELLED: "CANCELLED" },
  ACTOR_ROLES: { BUYER: "BUYER", SYSTEM: "SYSTEM" },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/image", () => ({
  getImageUrl: vi.fn().mockReturnValue("https://test.r2.dev/image.jpg"),
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findEmailVerified: vi.fn().mockResolvedValue({ emailVerified: new Date() }),
    findDisplayInfo: vi
      .fn()
      .mockResolvedValue({ displayName: "Seller", username: "seller1" }),
    findWithStripe: vi.fn().mockResolvedValue({
      stripeAccountId: "acct_1234567890abcdef",
      stripeOnboarded: true,
      displayName: "Seller",
    }),
  },
}));

vi.mock("@/server/email", () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { cartService } from "@/modules/cart/cart.service";
import { cartRepository } from "@/modules/cart/cart.repository";
import { paymentService } from "@/modules/payments/payment.service";
import { captureListingSnapshot } from "@/server/services/listing-snapshot.service";
import { userRepository } from "@/modules/users/user.repository";

// ── Helpers ────────────────────────────────────────────────────────────────

const validListing = {
  id: "listing-1",
  title: "Vintage Lamp",
  priceNzd: 5000,
  shippingNzd: 500,
  shippingOption: "COURIER",
  sellerId: "seller-1",
};

describe("CartService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: $transaction executes callback
    vi.mocked(cartRepository.$transaction).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. CART OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  describe("addToCart", () => {
    it("adds listing to empty cart successfully", async () => {
      vi.mocked(cartRepository.findListingForCart).mockResolvedValue(
        validListing as never,
      );
      vi.mocked(cartRepository.findByUser).mockResolvedValue(null);
      vi.mocked(cartRepository.createCart).mockResolvedValue({
        items: [{ id: "item-1" }],
      } as never);

      const result = await cartService.addToCart("buyer-1", "listing-1");

      expect(result).toEqual({ ok: true, data: { cartItemCount: 1 } });
      expect(cartRepository.createCart).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "buyer-1",
          sellerId: "seller-1",
          listingId: "listing-1",
          priceNzd: 5000,
          shippingNzd: 500,
        }),
      );
    });

    it("adds listing to existing cart from same seller", async () => {
      vi.mocked(cartRepository.findListingForCart).mockResolvedValue(
        validListing as never,
      );
      vi.mocked(cartRepository.findByUser).mockResolvedValue({
        id: "cart-1",
        sellerId: "seller-1",
        items: [{ listingId: "listing-other" }],
      } as never);
      vi.mocked(cartRepository.addItemToCart).mockResolvedValue({} as never);

      const result = await cartService.addToCart("buyer-1", "listing-1");

      expect(result).toEqual({ ok: true, data: { cartItemCount: 2 } });
      expect(cartRepository.addItemToCart).toHaveBeenCalledWith(
        "cart-1",
        expect.objectContaining({ listingId: "listing-1" }),
        expect.any(Date),
      );
    });

    it("fails if listing is not active", async () => {
      vi.mocked(cartRepository.findListingForCart).mockResolvedValue(null);

      const result = await cartService.addToCart("buyer-1", "missing");

      expect(result).toEqual({
        ok: false,
        error: "Listing is not available.",
      });
    });

    it("fails if listing is own listing", async () => {
      vi.mocked(cartRepository.findListingForCart).mockResolvedValue(
        validListing as never,
      );

      const result = await cartService.addToCart("seller-1", "listing-1");

      expect(result).toEqual({
        ok: false,
        error: "You cannot add your own listing to your cart.",
      });
    });

    it("fails if listing already in cart", async () => {
      vi.mocked(cartRepository.findListingForCart).mockResolvedValue(
        validListing as never,
      );
      vi.mocked(cartRepository.findByUser).mockResolvedValue({
        id: "cart-1",
        sellerId: "seller-1",
        items: [{ listingId: "listing-1" }],
      } as never);

      const result = await cartService.addToCart("buyer-1", "listing-1");

      expect(result).toEqual({
        ok: false,
        error: "This item is already in your cart.",
      });
    });

    it("enforces single seller restriction", async () => {
      vi.mocked(cartRepository.findListingForCart).mockResolvedValue(
        validListing as never,
      );
      vi.mocked(cartRepository.findByUser).mockResolvedValue({
        id: "cart-1",
        sellerId: "other-seller",
        items: [{ listingId: "listing-other" }],
      } as never);

      const result = await cartService.addToCart("buyer-1", "listing-1");

      expect(result).toEqual({ ok: false, error: "SELLER_MISMATCH" });
    });

    it("sets shipping to 0 for PICKUP items", async () => {
      vi.mocked(cartRepository.findListingForCart).mockResolvedValue({
        ...validListing,
        shippingOption: "PICKUP",
        shippingNzd: 500,
      } as never);
      vi.mocked(cartRepository.findByUser).mockResolvedValue(null);
      vi.mocked(cartRepository.createCart).mockResolvedValue({
        items: [{ id: "item-1" }],
      } as never);

      await cartService.addToCart("buyer-1", "listing-1");

      expect(cartRepository.createCart).toHaveBeenCalledWith(
        expect.objectContaining({ shippingNzd: 0 }),
      );
    });
  });

  // ── removeFromCart ─────────────────────────────────────────────────────

  describe("removeFromCart", () => {
    it("removes item from cart", async () => {
      vi.mocked(cartRepository.findByUserWithItems).mockResolvedValue({
        id: "cart-1",
        items: [
          { id: "item-1", listingId: "listing-1" },
          { id: "item-2", listingId: "listing-2" },
        ],
      } as never);
      vi.mocked(cartRepository.removeItemAndExtendExpiry).mockResolvedValue(
        undefined as never,
      );

      const result = await cartService.removeFromCart("buyer-1", "listing-1");

      expect(result).toEqual({ ok: true, data: { cartItemCount: 1 } });
      expect(cartRepository.removeItemAndExtendExpiry).toHaveBeenCalledWith(
        "item-1",
        "cart-1",
        expect.any(Date),
      );
    });

    it("deletes cart when last item removed", async () => {
      vi.mocked(cartRepository.findByUserWithItems).mockResolvedValue({
        id: "cart-1",
        items: [{ id: "item-1", listingId: "listing-1" }],
      } as never);
      vi.mocked(cartRepository.deleteCart).mockResolvedValue(
        undefined as never,
      );

      const result = await cartService.removeFromCart("buyer-1", "listing-1");

      expect(result).toEqual({ ok: true, data: { cartItemCount: 0 } });
      expect(cartRepository.deleteCart).toHaveBeenCalledWith("cart-1");
    });

    it("fails if cart not found", async () => {
      vi.mocked(cartRepository.findByUserWithItems).mockResolvedValue(null);

      const result = await cartService.removeFromCart("buyer-1", "listing-1");

      expect(result).toEqual({ ok: false, error: "Cart not found." });
    });

    it("fails if item not in cart", async () => {
      vi.mocked(cartRepository.findByUserWithItems).mockResolvedValue({
        id: "cart-1",
        items: [{ id: "item-1", listingId: "listing-other" }],
      } as never);

      const result = await cartService.removeFromCart("buyer-1", "listing-1");

      expect(result).toEqual({ ok: false, error: "Item not in cart." });
    });
  });

  // ── clearCart ──────────────────────────────────────────────────────────

  describe("clearCart", () => {
    it("deletes all carts for user", async () => {
      vi.mocked(cartRepository.deleteCartByUser).mockResolvedValue(
        undefined as never,
      );

      await cartService.clearCart("buyer-1");

      expect(cartRepository.deleteCartByUser).toHaveBeenCalledWith("buyer-1");
    });
  });

  // ── getCart ────────────────────────────────────────────────────────────

  describe("getCart", () => {
    it("returns cart data with computed totals", async () => {
      vi.mocked(cartRepository.findByUserForDisplay).mockResolvedValue({
        id: "cart-1",
        sellerId: "seller-1",
        expiresAt: new Date(Date.now() + 3600000),
        items: [
          {
            id: "item-1",
            listingId: "listing-1",
            priceNzd: 5000,
            shippingNzd: 500,
            listing: {
              title: "Lamp",
              status: "ACTIVE",
              deletedAt: null,
              priceNzd: 5000,
              shippingNzd: 500,
              shippingOption: "COURIER",
              images: [{ r2Key: "img.jpg" }],
            },
          },
        ],
      } as never);

      const result = await cartService.getCart("buyer-1");

      expect(result).not.toBeNull();
      expect(result!.subtotalNzd).toBe(5000);
      expect(result!.shippingNzd).toBe(500);
      expect(result!.totalNzd).toBe(5500);
      expect(result!.items[0].isAvailable).toBe(true);
    });

    it("returns null if no cart exists", async () => {
      vi.mocked(cartRepository.findByUserForDisplay).mockResolvedValue(null);

      const result = await cartService.getCart("buyer-1");

      expect(result).toBeNull();
    });

    it("returns null and deletes expired cart", async () => {
      vi.mocked(cartRepository.findByUserForDisplay).mockResolvedValue({
        id: "cart-1",
        sellerId: "seller-1",
        expiresAt: new Date(Date.now() - 1000),
        items: [],
      } as never);
      vi.mocked(cartRepository.deleteCart).mockResolvedValue(
        undefined as never,
      );

      const result = await cartService.getCart("buyer-1");

      expect(result).toBeNull();
      expect(cartRepository.deleteCart).toHaveBeenCalledWith("cart-1");
    });

    it("marks unavailable items as isAvailable false", async () => {
      vi.mocked(cartRepository.findByUserForDisplay).mockResolvedValue({
        id: "cart-1",
        sellerId: "seller-1",
        expiresAt: new Date(Date.now() + 3600000),
        items: [
          {
            id: "item-1",
            listingId: "listing-1",
            priceNzd: 5000,
            shippingNzd: 0,
            listing: {
              title: "Sold Item",
              status: "SOLD",
              deletedAt: null,
              priceNzd: 5000,
              shippingNzd: 0,
              shippingOption: "PICKUP",
              images: [],
            },
          },
        ],
      } as never);

      const result = await cartService.getCart("buyer-1");

      expect(result!.items[0].isAvailable).toBe(false);
    });
  });

  // ── getCartCount ──────────────────────────────────────────────────────

  describe("getCartCount", () => {
    it("returns item count for active cart", async () => {
      vi.mocked(cartRepository.findByUserCount).mockResolvedValue({
        expiresAt: new Date(Date.now() + 3600000),
        _count: { items: 3 },
      } as never);

      const result = await cartService.getCartCount("buyer-1");

      expect(result).toBe(3);
    });

    it("returns 0 for expired cart", async () => {
      vi.mocked(cartRepository.findByUserCount).mockResolvedValue({
        expiresAt: new Date(Date.now() - 1000),
        _count: { items: 3 },
      } as never);

      const result = await cartService.getCartCount("buyer-1");

      expect(result).toBe(0);
    });

    it("returns 0 when no cart exists", async () => {
      vi.mocked(cartRepository.findByUserCount).mockResolvedValue(null);

      const result = await cartService.getCartCount("buyer-1");

      expect(result).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. CHECKOUT
  // ─────────────────────────────────────────────────────────────────────────

  describe("checkoutCart", () => {
    const checkoutCartData = {
      id: "cart-1",
      sellerId: "seller-1",
      expiresAt: new Date(Date.now() + 3600000),
      items: [
        {
          id: "item-1",
          listingId: "listing-1",
          priceNzd: 5000,
          shippingNzd: 500,
          listing: {
            id: "listing-1",
            title: "Vintage Lamp",
            priceNzd: 5000,
            shippingNzd: 500,
            shippingOption: "COURIER",
            status: "ACTIVE",
            sellerId: "seller-1",
            deletedAt: null,
          },
        },
      ],
    };

    beforeEach(() => {
      vi.mocked(cartRepository.findByUserForCheckout).mockResolvedValue(
        checkoutCartData as never,
      );
      vi.mocked(cartRepository.reserveListings).mockResolvedValue({
        count: 1,
      } as never);
      vi.mocked(cartRepository.createOrder).mockResolvedValue({
        id: "order-1",
      } as never);
      vi.mocked(cartRepository.updateOrderStripePI).mockResolvedValue(
        undefined as never,
      );
      vi.mocked(cartRepository.findBuyerDisplayName).mockResolvedValue({
        displayName: "Buyer",
      } as never);
      // Reset userRepository mocks (cleared by other tests)
      vi.mocked(userRepository.findWithStripe).mockResolvedValue({
        stripeAccountId: "acct_1234567890abcdef",
        stripeOnboarded: true,
        displayName: "Seller",
      } as never);
      // Reset paymentService mock
      vi.mocked(paymentService.createPaymentIntent).mockResolvedValue({
        paymentIntentId: "pi_test_123",
        clientSecret: "cs_test_secret",
      } as never);
    });

    it("creates order with payment intent successfully", async () => {
      const result = await cartService.checkoutCart(
        "buyer-1",
        "buyer@test.com",
        {},
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.orderId).toBe("order-1");
        expect(result.data.clientSecret).toBe("cs_test_secret");
      }
    });

    it("fails if cart is empty", async () => {
      vi.mocked(cartRepository.findByUserForCheckout).mockResolvedValue(null);

      const result = await cartService.checkoutCart(
        "buyer-1",
        "buyer@test.com",
        {},
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("empty");
    });

    it("fails if cart expired", async () => {
      vi.mocked(cartRepository.findByUserForCheckout).mockResolvedValue({
        ...checkoutCartData,
        expiresAt: new Date(Date.now() - 1000),
      } as never);
      vi.mocked(cartRepository.deleteCart).mockResolvedValue(
        undefined as never,
      );

      const result = await cartService.checkoutCart(
        "buyer-1",
        "buyer@test.com",
        {},
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("expired");
    });

    it("fails if any listing became inactive", async () => {
      vi.mocked(cartRepository.findByUserForCheckout).mockResolvedValue({
        ...checkoutCartData,
        items: [
          {
            ...checkoutCartData.items[0],
            listing: {
              ...checkoutCartData.items[0].listing,
              status: "SOLD",
            },
          },
        ],
      } as never);

      const result = await cartService.checkoutCart(
        "buyer-1",
        "buyer@test.com",
        {},
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("no longer available");
    });

    it("fails if items from different sellers", async () => {
      vi.mocked(cartRepository.findByUserForCheckout).mockResolvedValue({
        ...checkoutCartData,
        items: [
          checkoutCartData.items[0],
          {
            ...checkoutCartData.items[0],
            id: "item-2",
            listingId: "listing-2",
            listing: {
              ...checkoutCartData.items[0].listing,
              id: "listing-2",
              sellerId: "other-seller",
            },
          },
        ],
      } as never);

      const result = await cartService.checkoutCart(
        "buyer-1",
        "buyer@test.com",
        {},
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("different sellers");
    });

    it("fails if seller has not completed Stripe setup", async () => {
      vi.mocked(userRepository.findWithStripe).mockResolvedValue({
        stripeAccountId: null,
        stripeOnboarded: false,
      } as never);

      const result = await cartService.checkoutCart(
        "buyer-1",
        "buyer@test.com",
        {},
      );

      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toContain("not completed payment setup");
    });

    it("captures listing snapshots for each item", async () => {
      await cartService.checkoutCart("buyer-1", "buyer@test.com", {});

      expect(captureListingSnapshot).toHaveBeenCalledWith(
        "order-1",
        "listing-1",
        expect.anything(),
      );
    });

    it("reserves listings atomically before creating order", async () => {
      await cartService.checkoutCart("buyer-1", "buyer@test.com", {});

      expect(cartRepository.reserveListings).toHaveBeenCalledWith([
        "listing-1",
      ]);
    });

    it("releases listings if reservation count mismatch", async () => {
      vi.mocked(cartRepository.reserveListings).mockResolvedValue({
        count: 0,
      } as never);
      vi.mocked(cartRepository.releaseListings).mockResolvedValue(
        undefined as never,
      );

      const result = await cartService.checkoutCart(
        "buyer-1",
        "buyer@test.com",
        {},
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("no longer available");
      expect(cartRepository.releaseListings).toHaveBeenCalledWith([
        "listing-1",
      ]);
    });

    it("returns existing order for idempotent request", async () => {
      vi.mocked(cartRepository.findIdempotentOrder).mockResolvedValue({
        id: "existing-order",
        status: "AWAITING_PAYMENT",
        stripePaymentIntentId: "pi_existing",
      } as never);

      const result = await cartService.checkoutCart(
        "buyer-1",
        "buyer@test.com",
        { idempotencyKey: "key-1" },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.orderId).toBe("existing-order");
      }
      expect(cartRepository.createOrder).not.toHaveBeenCalled();
    });

    it("handles Stripe failure: cancels order and releases listings", async () => {
      vi.mocked(paymentService.createPaymentIntent).mockRejectedValue(
        new Error("card_declined"),
      );
      vi.mocked(cartRepository.findOrderStripePI).mockResolvedValue(
        null as never,
      );
      vi.mocked(cartRepository.releaseListings).mockResolvedValue(
        undefined as never,
      );

      const result = await cartService.checkoutCart(
        "buyer-1",
        "buyer@test.com",
        {},
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("Payment setup failed");
      expect(cartRepository.releaseListings).toHaveBeenCalled();
    });
  });
});
