// src/test/cart.actions.test.ts
// ─── Tests: Shopping Cart Server Actions ────────────────────────────────────
// Covers all 6 exported actions:
//   addToCart, removeFromCart, clearCart, getCart, getCartCount, checkoutCart

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock request context — withActionContext calls runWithRequestContext ───────
vi.mock("@/lib/request-context", () => ({
  runWithRequestContext: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  getRequestContext: () => ({ correlationId: "test-correlation-id" }),
}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock cartService BEFORE import ───────────────────────────────────────────
const mockAddToCart = vi.fn();
const mockRemoveFromCart = vi.fn();
const mockClearCart = vi.fn();
const mockGetCart = vi.fn();
const mockGetCartCount = vi.fn();
const mockCheckoutCart = vi.fn();

vi.mock("@/modules/cart/cart.service", () => ({
  cartService: {
    addToCart: (...args: unknown[]) => mockAddToCart(...args),
    removeFromCart: (...args: unknown[]) => mockRemoveFromCart(...args),
    clearCart: (...args: unknown[]) => mockClearCart(...args),
    getCart: (...args: unknown[]) => mockGetCart(...args),
    getCartCount: (...args: unknown[]) => mockGetCartCount(...args),
    checkoutCart: (...args: unknown[]) => mockCheckoutCart(...args),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const {
  addToCart,
  removeFromCart,
  clearCart,
  getCart,
  getCartCount,
  checkoutCart,
} = await import("@/server/actions/cart");
const { rateLimit } = await import("@/server/lib/rateLimit");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER = { id: "user_buyer", email: "buyer@test.com", isAdmin: false };

const validShippingAddress = {
  name: "Jane Smith",
  line1: "123 Queen Street",
  city: "Auckland",
  region: "Auckland",
  postcode: "1010",
};

// ─────────────────────────────────────────────────────────────────────────────
// addToCart
// ─────────────────────────────────────────────────────────────────────────────

describe("addToCart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockAddToCart.mockResolvedValue({ ok: true, data: { cartItemCount: 1 } });
  });

  it("unauthenticated → returns auth error and does not call service", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await addToCart({ listingId: "listing_1" });

    expect(result.success).toBe(false);
    expect(mockAddToCart).not.toHaveBeenCalled();
  });

  it("invalid input (missing listingId) → returns validation error", async () => {
    const result = await addToCart({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
    expect(mockAddToCart).not.toHaveBeenCalled();
  });

  it("invalid input (empty listingId) → returns validation error", async () => {
    const result = await addToCart({ listingId: "" });

    expect(result.success).toBe(false);
    expect(mockAddToCart).not.toHaveBeenCalled();
  });

  it("happy path → returns updated cartItemCount", async () => {
    const result = await addToCart({ listingId: "listing_1" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cartItemCount).toBe(1);
    }
    expect(mockAddToCart).toHaveBeenCalledWith("user_buyer", "listing_1");
  });

  it("rate limit exceeded → returns rate limit error without calling service", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await addToCart({ listingId: "listing_1" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many|wait/i);
    }
    expect(mockAddToCart).not.toHaveBeenCalled();
  });

  it("service returns ok:false → propagates error", async () => {
    mockAddToCart.mockResolvedValueOnce({
      ok: false,
      error: "Listing is no longer available.",
    });

    const result = await addToCart({ listingId: "listing_1" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Listing is no longer available.");
    }
  });

  it("service throws → returns safe fallback error", async () => {
    mockAddToCart.mockRejectedValueOnce(new Error("DB timeout"));

    const result = await addToCart({ listingId: "listing_1" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// removeFromCart
// ─────────────────────────────────────────────────────────────────────────────

describe("removeFromCart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockRemoveFromCart.mockResolvedValue({
      ok: true,
      data: { cartItemCount: 0 },
    });
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await removeFromCart({ listingId: "listing_1" });

    expect(result.success).toBe(false);
    expect(mockRemoveFromCart).not.toHaveBeenCalled();
  });

  it("invalid input (missing listingId) → returns validation error", async () => {
    const result = await removeFromCart({});

    expect(result.success).toBe(false);
    expect(mockRemoveFromCart).not.toHaveBeenCalled();
  });

  it("happy path → returns updated cartItemCount", async () => {
    const result = await removeFromCart({ listingId: "listing_1" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cartItemCount).toBe(0);
    }
    expect(mockRemoveFromCart).toHaveBeenCalledWith("user_buyer", "listing_1");
  });

  it("rate limit exceeded → returns rate limit error", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await removeFromCart({ listingId: "listing_1" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many|wait/i);
    }
    expect(mockRemoveFromCart).not.toHaveBeenCalled();
  });

  it("service returns ok:false → propagates error", async () => {
    mockRemoveFromCart.mockResolvedValueOnce({
      ok: false,
      error: "Item not found in cart.",
    });

    const result = await removeFromCart({ listingId: "listing_1" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Item not found in cart.");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearCart
// ─────────────────────────────────────────────────────────────────────────────

describe("clearCart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockClearCart.mockResolvedValue(undefined);
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await clearCart();

    expect(result.success).toBe(false);
    expect(mockClearCart).not.toHaveBeenCalled();
  });

  it("happy path → clears cart and returns success", async () => {
    const result = await clearCart();

    expect(result.success).toBe(true);
    expect(mockClearCart).toHaveBeenCalledWith("user_buyer");
  });

  it("rate limit exceeded → returns rate limit error", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await clearCart();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many|wait/i);
    }
    expect(mockClearCart).not.toHaveBeenCalled();
  });

  it("service throws → returns safe fallback error", async () => {
    mockClearCart.mockRejectedValueOnce(new Error("Unexpected error"));

    const result = await clearCart();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCart
// ─────────────────────────────────────────────────────────────────────────────

describe("getCart", () => {
  const mockCartData = {
    id: "cart_1",
    userId: "user_buyer",
    items: [],
    totalNzd: 0,
    itemCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockGetCart.mockResolvedValue(mockCartData);
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await getCart();

    expect(result.success).toBe(false);
    expect(mockGetCart).not.toHaveBeenCalled();
  });

  it("happy path → returns cart data", async () => {
    const result = await getCart();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(mockCartData);
    }
    expect(mockGetCart).toHaveBeenCalledWith("user_buyer");
  });

  it("service returns null → returns null data (empty cart)", async () => {
    mockGetCart.mockResolvedValueOnce(null);

    const result = await getCart();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it("service throws → returns safe fallback error", async () => {
    mockGetCart.mockRejectedValueOnce(new Error("DB error"));

    const result = await getCart();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCartCount
// ─────────────────────────────────────────────────────────────────────────────

describe("getCartCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockGetCartCount.mockResolvedValue(3);
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await getCartCount();

    expect(result.success).toBe(false);
    expect(mockGetCartCount).not.toHaveBeenCalled();
  });

  it("happy path → returns cart item count", async () => {
    const result = await getCartCount();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(3);
    }
    expect(mockGetCartCount).toHaveBeenCalledWith("user_buyer");
  });

  it("service throws → returns safe fallback error", async () => {
    mockGetCartCount.mockRejectedValueOnce(new Error("Network error"));

    const result = await getCartCount();

    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkoutCart
// ─────────────────────────────────────────────────────────────────────────────

describe("checkoutCart", () => {
  const validCheckoutInput = {
    shippingAddress: validShippingAddress,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockCheckoutCart.mockResolvedValue({
      ok: true,
      data: { orderId: "order_1", clientSecret: "cs_test_secret" },
    });
  });

  it("unauthenticated → returns auth error and does not call service", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthenticated"));

    const result = await checkoutCart(validCheckoutInput);

    expect(result.success).toBe(false);
    expect(mockCheckoutCart).not.toHaveBeenCalled();
  });

  it("invalid input (bad postcode) → returns validation error", async () => {
    const result = await checkoutCart({
      shippingAddress: {
        ...validShippingAddress,
        postcode: "ABC",
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
    expect(mockCheckoutCart).not.toHaveBeenCalled();
  });

  it("invalid input (name too short in address) → returns validation error", async () => {
    const result = await checkoutCart({
      shippingAddress: {
        ...validShippingAddress,
        name: "J", // min 2 chars
      },
    });

    expect(result.success).toBe(false);
    expect(mockCheckoutCart).not.toHaveBeenCalled();
  });

  it("happy path → returns orderId and clientSecret", async () => {
    const result = await checkoutCart(validCheckoutInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orderId).toBe("order_1");
      expect(result.data.clientSecret).toBe("cs_test_secret");
    }
    expect(mockCheckoutCart).toHaveBeenCalledWith(
      "user_buyer",
      "buyer@test.com",
      expect.objectContaining({ shippingAddress: validShippingAddress }),
    );
  });

  it("happy path with idempotencyKey → passes key to service", async () => {
    const result = await checkoutCart({
      ...validCheckoutInput,
      idempotencyKey: "idem_key_abc123",
    });

    expect(result.success).toBe(true);
    expect(mockCheckoutCart).toHaveBeenCalledWith(
      "user_buyer",
      "buyer@test.com",
      expect.objectContaining({ idempotencyKey: "idem_key_abc123" }),
    );
  });

  it("rate limit exceeded → returns rate limit error", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await checkoutCart(validCheckoutInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many|wait/i);
    }
    expect(mockCheckoutCart).not.toHaveBeenCalled();
  });

  it("service returns ok:false (basic error) → propagates error", async () => {
    mockCheckoutCart.mockResolvedValueOnce({
      ok: false,
      error: "Cart is empty.",
    });

    const result = await checkoutCart(validCheckoutInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Cart is empty.");
    }
  });

  it("service returns price drift → propagates requiresPriceConfirmation and driftedItems", async () => {
    const driftedItems = [
      {
        listingId: "listing_1",
        title: "Widget",
        oldPriceNzd: 100_00,
        newPriceNzd: 110_00,
      },
    ];
    mockCheckoutCart.mockResolvedValueOnce({
      ok: false,
      error: "Prices have changed since you added items to your cart.",
      requiresPriceConfirmation: true,
      driftedItems,
    });

    const result = await checkoutCart(validCheckoutInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.requiresPriceConfirmation).toBe(true);
      expect(result.driftedItems).toEqual(driftedItems);
    }
  });

  it("service throws → returns safe fallback error", async () => {
    mockCheckoutCart.mockRejectedValueOnce(new Error("Stripe API error"));

    const result = await checkoutCart(validCheckoutInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});
