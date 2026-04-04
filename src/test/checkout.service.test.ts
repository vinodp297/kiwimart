// src/test/checkout.service.test.ts
// ─── Integration tests for checkout and payment flow ────────────────────────
// Covers: order creation, payment capture, cancellation, delivery confirmation,
// and the order state machine.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockStripeCreate,
  mockStripeCapture,
  mockStripeRetrieve,
} from "./setup";
import db from "@/lib/db";

// ── Patch missing Prisma models onto the mocked db ──────────────────────────
// The global setup.ts mocks core models but doesn't include orderEvent,
// platformConfig, listingSnapshot, or notification. Add them here.
const _db = db as Record<string, unknown>;
if (!_db.orderEvent) {
  _db.orderEvent = { create: vi.fn().mockResolvedValue({ id: "evt-1" }) };
}
if (!_db.platformConfig) {
  _db.platformConfig = { findUnique: vi.fn().mockResolvedValue(null) };
}
if (!_db.listingSnapshot) {
  _db.listingSnapshot = { create: vi.fn().mockResolvedValue({ id: "snap-1" }) };
}
if (!_db.notification) {
  _db.notification = { create: vi.fn().mockResolvedValue({ id: "notif-1" }) };
}

// ── Additional mocks not in global setup ────────────────────────────────────

// server-only is a build-time guard — noop in test
vi.mock("server-only", () => ({}));

// Platform config — used by cancellation window logic
vi.mock("@/lib/platform-config", () => ({
  CONFIG_KEYS: {
    FREE_CANCEL_WINDOW_MINUTES: "FREE_CANCEL_WINDOW_MINUTES",
    CANCEL_REQUEST_WINDOW_HOURS: "CANCEL_REQUEST_WINDOW_HOURS",
  },
  getConfigInt: vi.fn().mockImplementation((key: string) => {
    if (key === "FREE_CANCEL_WINDOW_MINUTES") return Promise.resolve(60);
    if (key === "CANCEL_REQUEST_WINDOW_HOURS") return Promise.resolve(24);
    return Promise.resolve(0);
  }),
  getConfigMany: vi.fn().mockResolvedValue(new Map()),
}));

// Notification service — fire-and-forget in production
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// Listing snapshot — captured at order creation
vi.mock("@/server/services/listing-snapshot.service", () => ({
  captureListingSnapshot: vi.fn().mockResolvedValue(undefined),
}));

// Order interaction service — used by delivery issue flow
vi.mock("@/modules/orders/order-interaction.service", () => ({
  orderInteractionService: {
    createInteraction: vi.fn().mockResolvedValue(undefined),
  },
  INTERACTION_TYPES: { DELIVERY_ISSUE: "DELIVERY_ISSUE" },
  AUTO_ACTIONS: { AUTO_ESCALATE: "AUTO_ESCALATE" },
}));

// Cancellation email
vi.mock("@/server/email", () => ({
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
}));

// User repository
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findEmailVerified: vi
      .fn()
      .mockResolvedValue({ id: "buyer-1", emailVerified: true }),
  },
}));

// ── Lazy imports (after mocks are set up) ───────────────────────────────────

const { createOrder } = await import("@/modules/orders/order-create.service");
const { confirmDelivery } =
  await import("@/modules/orders/order-dispatch.service");
const { cancelOrder } = await import("@/modules/orders/order-cancel.service");
const { transitionOrder, assertOrderTransition, VALID_ORDER_TRANSITIONS } =
  await import("@/modules/orders/order.transitions");
const { captureListingSnapshot } =
  await import("@/server/services/listing-snapshot.service");

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Standard active listing returned by repository */
const validListing = {
  id: "listing-1",
  title: "Vintage Lamp",
  priceNzd: 5000,
  shippingNzd: 500,
  shippingOption: "COURIER",
  sellerId: "seller-1",
  seller: {
    stripeAccountId: "acct_1234567890abcdef",
    stripeOnboarded: true,
    displayName: "Test Seller",
  },
};

/** Helpers to mock db.$transaction — runs callback with db as tx */
function mockTransaction() {
  vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
    if (typeof fn === "function") {
      return (fn as (tx: typeof db) => Promise<unknown>)(db);
    }
    return undefined;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ORDER CREATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Order Creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction();

    // Default: listing lookup succeeds
    vi.mocked(db.listing.findUnique).mockResolvedValue(validListing as never);
    // Default: reservation succeeds
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 } as never);
    // Default: order create succeeds
    vi.mocked(db.order.create).mockResolvedValue({ id: "order-1" } as never);
    // Default: Stripe succeeds
    mockStripeCreate.mockResolvedValue({
      id: "pi_test_123",
      client_secret: "cs_test_secret",
      amount: 5500,
    });
    // Default: PI stored
    vi.mocked(db.order.update).mockResolvedValue({} as never);
    vi.mocked(db.order.findUnique).mockResolvedValue(null as never);
    // user lookup for notifications
    vi.mocked(db.user.findUnique).mockResolvedValue({
      displayName: "Buyer",
    } as never);
  });

  it("creates order successfully with valid listing and buyer", async () => {
    const result = await createOrder(
      "buyer-1",
      "buyer@test.com",
      { listingId: "listing-1" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orderId).toBe("order-1");
      expect(result.clientSecret).toBe("cs_test_secret");
    }
    expect(mockStripeCreate).toHaveBeenCalled();
  });

  it("fails if listing is not active (not found)", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(null as never);

    const result = await createOrder(
      "buyer-1",
      "buyer@test.com",
      { listingId: "missing-listing" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not available");
    }
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  it("fails if buyer is the seller", async () => {
    const result = await createOrder(
      "seller-1", // same as listing.sellerId
      "seller@test.com",
      { listingId: "listing-1" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("cannot purchase your own");
    }
  });

  it("fails if listing already has a pending order (reservation race)", async () => {
    // Reservation fails — another buyer got there first
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await createOrder(
      "buyer-1",
      "buyer@test.com",
      { listingId: "listing-1" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no longer available");
    }
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("creates listing snapshot at time of purchase", async () => {
    await createOrder(
      "buyer-1",
      "buyer@test.com",
      { listingId: "listing-1" },
      "127.0.0.1",
    );

    expect(captureListingSnapshot).toHaveBeenCalledWith(
      "order-1",
      "listing-1",
      expect.anything(), // tx client
    );
  });

  it("creates payment intent via Stripe", async () => {
    await createOrder(
      "buyer-1",
      "buyer@test.com",
      { listingId: "listing-1" },
      "127.0.0.1",
    );

    expect(mockStripeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5500, // priceNzd (5000) + shippingNzd (500)
        currency: "nzd",
        capture_method: "manual",
      }),
    );
  });

  it("sets order status to AWAITING_PAYMENT for shipped orders", async () => {
    await createOrder(
      "buyer-1",
      "buyer@test.com",
      { listingId: "listing-1" },
      "127.0.0.1",
    );

    expect(db.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "AWAITING_PAYMENT" }),
      }),
    );
  });

  it("idempotency: same key returns existing order", async () => {
    // Simulate existing order found by idempotency key
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "existing-order",
      status: "AWAITING_PAYMENT",
      stripePaymentIntentId: "pi_existing",
      listingId: "listing-1",
    } as never);

    mockStripeRetrieve.mockResolvedValueOnce({
      id: "pi_existing",
      client_secret: "cs_existing_secret",
    });

    const result = await createOrder(
      "buyer-1",
      "buyer@test.com",
      { listingId: "listing-1", idempotencyKey: "idem-key-1" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orderId).toBe("existing-order");
      expect(result.clientSecret).toBe("cs_existing_secret");
    }
    // Should NOT create a new order
    expect(db.order.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PAYMENT CAPTURE (via confirmDelivery)
// ─────────────────────────────────────────────────────────────────────────────

describe("Payment Capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction();
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.payout.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it("captures payment when order is confirmed", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      status: "DISPATCHED",
      stripePaymentIntentId: "pi_capture_me",
      totalNzd: 5000,
    } as never);

    mockStripeCapture.mockResolvedValueOnce({
      id: "pi_capture_me",
      status: "succeeded",
    });

    vi.mocked(db.user.findUnique).mockResolvedValue({
      stripeAccountId: "acct_seller123456789",
    } as never);

    await expect(
      confirmDelivery("order-1", "buyer-1"),
    ).resolves.toBeUndefined();

    expect(mockStripeCapture).toHaveBeenCalledWith("pi_capture_me");
  });

  it("updates order status to COMPLETED after capture", async () => {
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
    vi.mocked(db.user.findUnique).mockResolvedValue({
      stripeAccountId: "acct_test123456789",
    } as never);

    await confirmDelivery("order-1", "buyer-1");

    expect(db.$transaction).toHaveBeenCalled();
    // Verify updateMany was called with COMPLETED status
    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("fails if order is not in correct state for capture", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      status: "PAYMENT_HELD", // not DISPATCHED or DELIVERED
      stripePaymentIntentId: "pi_test",
      totalNzd: 5000,
    } as never);

    await expect(confirmDelivery("order-1", "buyer-1")).rejects.toThrow(
      "not in a deliverable state",
    );

    expect(mockStripeCapture).not.toHaveBeenCalled();
  });

  it("handles Stripe capture failure gracefully — no DB update", async () => {
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

    await expect(confirmDelivery("order-1", "buyer-1")).rejects.toThrow();

    // DB transaction must NOT have been called
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ORDER CANCELLATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Order Cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction();
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it("buyer can cancel within free cancel window", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      status: "PAYMENT_HELD",
      createdAt: new Date(), // Just created — within free window
    } as never);

    // findByIdForCancellationEmail
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: "order-1",
      totalNzd: 5000,
      buyer: { email: "buyer@t.com", displayName: "Buyer" },
      seller: { email: "seller@t.com", displayName: "Seller" },
      listing: { title: "Test" },
    } as never);

    await expect(cancelOrder("order-1", "buyer-1")).resolves.toBeUndefined();

    expect(db.$transaction).toHaveBeenCalled();
  });

  it("buyer cannot cancel after cancel window expires", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      status: "PAYMENT_HELD",
      // Created 25 hours ago — beyond the 24-hour request window
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    } as never);

    await expect(cancelOrder("order-1", "buyer-1")).rejects.toThrow(
      "window has closed",
    );
  });

  it("cancellation restores listing to active status", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      status: "PAYMENT_HELD",
      createdAt: new Date(),
    } as never);

    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: "order-1",
      totalNzd: 5000,
      buyer: { email: "b@t.com", displayName: "B" },
      seller: { email: "s@t.com", displayName: "S" },
      listing: { title: "Item" },
    } as never);

    await cancelOrder("order-1", "buyer-1");

    // reactivateListingInTx calls listing.updateMany with RESERVED → ACTIVE
    expect(db.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "listing-1",
          status: "RESERVED",
        }),
        data: { status: "ACTIVE" },
      }),
    );
  });

  it("cancelled order cannot be cancelled again (wrong state)", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      status: "CANCELLED",
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    } as never);

    await expect(cancelOrder("order-1", "buyer-1")).rejects.toThrow(
      "cannot be cancelled",
    );
  });

  it("dispatched order cannot be cancelled", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      status: "DISPATCHED",
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    } as never);

    await expect(cancelOrder("order-1", "buyer-1")).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DELIVERY CONFIRMATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Delivery Confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction();
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.payout.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.listing.findUnique).mockResolvedValue({
      title: "Test",
    } as never);
  });

  it("buyer confirms delivery successfully", async () => {
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
    vi.mocked(db.user.findUnique).mockResolvedValue({
      stripeAccountId: "acct_test123456789",
    } as never);

    await expect(
      confirmDelivery("order-1", "buyer-1"),
    ).resolves.toBeUndefined();
  });

  it("triggers payout queue job after delivery", async () => {
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
    vi.mocked(db.user.findUnique).mockResolvedValue({
      stripeAccountId: "acct_payout12345678",
    } as never);

    await confirmDelivery("order-1", "buyer-1");

    // payoutQueue.add is mocked globally in setup.ts
    const { payoutQueue } = await import("@/lib/queue");
    expect(payoutQueue.add).toHaveBeenCalledWith(
      "process-payout",
      expect.objectContaining({
        orderId: "order-1",
        sellerId: "seller-1",
        amountNzd: 5000,
        stripeAccountId: "acct_payout12345678",
      }),
      expect.objectContaining({
        delay: expect.any(Number),
        attempts: 3,
      }),
    );
  });

  it("cannot confirm delivery on non-dispatched order", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      status: "PAYMENT_HELD",
      stripePaymentIntentId: "pi_test",
      totalNzd: 5000,
    } as never);

    await expect(confirmDelivery("order-1", "buyer-1")).rejects.toThrow(
      "not in a deliverable state",
    );
  });

  it("non-buyer cannot confirm delivery", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      status: "DISPATCHED",
      stripePaymentIntentId: "pi_test",
      totalNzd: 5000,
    } as never);

    await expect(confirmDelivery("order-1", "seller-1")).rejects.toThrow(
      "Only the buyer",
    );
  });

  it("throws for non-existent order", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(null as never);

    await expect(confirmDelivery("order-missing", "buyer-1")).rejects.toThrow(
      "Order not found",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ORDER STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

describe("Order State Machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("valid transitions", () => {
    it.each([
      ["AWAITING_PAYMENT", "PAYMENT_HELD"],
      ["AWAITING_PAYMENT", "CANCELLED"],
      ["PAYMENT_HELD", "DISPATCHED"],
      ["PAYMENT_HELD", "CANCELLED"],
      ["DISPATCHED", "DELIVERED"],
      ["DISPATCHED", "COMPLETED"],
      ["DELIVERED", "COMPLETED"],
    ])("%s → %s succeeds", async (from, to) => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        id: "order-sm",
        status: from,
      } as never);
      vi.mocked(db.order.updateMany).mockResolvedValue({
        count: 1,
      } as never);

      await expect(
        transitionOrder("order-sm", to, {}, { fromStatus: from }),
      ).resolves.toBeUndefined();

      expect(db.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "order-sm",
            status: from,
          }),
          data: expect.objectContaining({ status: to }),
        }),
      );
    });
  });

  describe("invalid transitions", () => {
    it.each([
      ["COMPLETED", "DISPATCHED"],
      ["CANCELLED", "PAYMENT_HELD"],
      ["REFUNDED", "COMPLETED"],
      ["AWAITING_PAYMENT", "DISPATCHED"],
      ["DISPATCHED", "PAYMENT_HELD"],
      ["PAYMENT_HELD", "DELIVERED"],
    ])("%s → %s throws", (from, to) => {
      expect(() => assertOrderTransition("order-sm", from, to)).toThrow(
        `Invalid order transition: ${from} → ${to}`,
      );
    });
  });

  describe("terminal states", () => {
    it.each(["COMPLETED", "REFUNDED", "CANCELLED"])(
      "%s has no outgoing transitions",
      (state) => {
        const allowed = VALID_ORDER_TRANSITIONS[state];
        expect(allowed).toEqual([]);
      },
    );
  });

  describe("optimistic locking", () => {
    it("prevents concurrent state changes (count=0 means race lost)", async () => {
      vi.mocked(db.order.updateMany).mockResolvedValue({
        count: 0,
      } as never);

      await expect(
        transitionOrder(
          "order-sm",
          "DISPATCHED",
          {},
          { fromStatus: "PAYMENT_HELD" },
        ),
      ).rejects.toThrow("concurrent modification");
    });
  });
});
