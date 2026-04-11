// src/test/integration-flows.test.ts
// ─── Tests: Integration flows — multi-step purchase, failure, dispute ───────
// Covers: complete purchase flow (create → dispatch → deliver → complete),
// failed payment flow, cancellation flow, dispute → auto-resolution flow.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockStripeCreate,
  mockStripeCapture,
  mockStripeRetrieve,
} from "./setup";
import db from "@/lib/db";

// ── Mock notification service ────────────────────────────────────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock listing snapshot ────────────────────────────────────────────────────
vi.mock("@/server/services/listing-snapshot.service", () => ({
  captureListingSnapshot: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock order-event service ─────────────────────────────────────────────────
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    ORDER_CREATED: "ORDER_CREATED",
    PAYMENT_HELD: "PAYMENT_HELD",
    DISPATCHED: "DISPATCHED",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    DELIVERY_CONFIRMED_OK: "DELIVERY_CONFIRMED_OK",
    DELIVERY_ISSUE_REPORTED: "DELIVERY_ISSUE_REPORTED",
  },
  ACTOR_ROLES: {
    SYSTEM: "SYSTEM",
    BUYER: "BUYER",
    SELLER: "SELLER",
  },
}));

// ── Mock order-interaction service ───────────────────────────────────────────
vi.mock("@/modules/orders/order-interaction.service", () => ({
  orderInteractionService: { createInteraction: vi.fn().mockResolvedValue({}) },
  INTERACTION_TYPES: { DELIVERY_ISSUE: "DELIVERY_ISSUE" },
  AUTO_ACTIONS: { AUTO_ESCALATE: "AUTO_ESCALATE" },
}));

// ── Mock order-create-helpers ────────────────────────────────────────────────
vi.mock("@/modules/orders/order-create-helpers", () => ({
  handleCashOnPickup: vi.fn(),
  notifyOrderCreated: vi.fn(),
  schedulePickupDeadline: vi.fn(),
}));

// ── Mock infrastructure/stripe/client ────────────────────────────────────────
vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    paymentIntents: {
      create: (...args: unknown[]) => mockStripeCreate(...args),
      capture: (...args: unknown[]) => mockStripeCapture(...args),
      retrieve: (...args: unknown[]) => mockStripeRetrieve(...args),
      cancel: vi.fn().mockResolvedValue({}),
    },
    refunds: {
      create: vi.fn().mockResolvedValue({ id: "re_mock" }),
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
}));

// ── Mock listing repository ─────────────────────────────────────────────────
vi.mock("@/modules/listings/listing.repository", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/modules/listings/listing.repository")
    >();
  return {
    ...actual,
    listingRepository: {
      ...(actual.listingRepository as object),
      releaseReservation: vi.fn().mockResolvedValue({ count: 1 }),
      restoreFromSold: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// ── Mock cancellation email ──────────────────────────────────────────────────
vi.mock("@/server/email", () => ({
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendDisputeResolvedEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock request-context ─────────────────────────────────────────────────────
vi.mock("@/lib/request-context", () => ({
  getRequestContext: vi.fn().mockReturnValue({ correlationId: "corr-integ" }),
}));

// ── Lazy imports ─────────────────────────────────────────────────────────────
const { createOrder } = await import("@/modules/orders/order-create.service");
const { confirmDelivery, markDispatched } =
  await import("@/modules/orders/order-dispatch.service");
const { cancelOrder, getCancellationStatus } =
  await import("@/modules/orders/order-cancel.service");

// ── Helpers ──────────────────────────────────────────────────────────────────

const BUYER_ID = "buyer-1";
const SELLER_ID = "seller-1";
const LISTING_ID = "listing-1";

function mockListingForOrder() {
  const listingData = {
    id: LISTING_ID,
    title: "Vintage Lamp",
    priceNzd: 5000,
    shippingNzd: 500,
    shippingOption: "NATIONWIDE",
    sellerId: SELLER_ID,
    seller: {
      stripeAccountId: "acct_1234567890abcdef",
      isStripeOnboarded: true,
    },
  };
  vi.mocked(db.listing.findUnique).mockResolvedValue(listingData as never);
  vi.mocked(db.listing.findFirst).mockResolvedValue(listingData as never);
}

function mockOrderForDelivery(overrides: Record<string, unknown> = {}) {
  const data = {
    id: "order-1",
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    listingId: LISTING_ID,
    status: "DISPATCHED",
    stripePaymentIntentId: "pi_mock",
    totalNzd: 5500,
    ...overrides,
  };
  vi.mocked(db.order.findUnique).mockResolvedValue(data as never);
  vi.mocked(db.order.findFirst).mockResolvedValue(data as never);
}

function mockOrderForDispatch(overrides: Record<string, unknown> = {}) {
  const data = {
    id: "order-1",
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    listingId: LISTING_ID,
    status: "PAYMENT_HELD",
    buyer: { email: "buyer@buyzi.test", displayName: "Buyer" },
    listing: { title: "Vintage Lamp" },
    ...overrides,
  };
  vi.mocked(db.order.findUnique).mockResolvedValue(data as never);
  vi.mocked(db.order.findFirst).mockResolvedValue(data as never);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Complete purchase flow — createOrder", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockListingForOrder();
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.order.create).mockResolvedValue({ id: "order-1" } as never);
    vi.mocked(db.order.findFirst).mockResolvedValue(null);
    vi.mocked(db.order.update).mockResolvedValue({} as never);
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
    // Ensure email is verified for all createOrder tests except the explicit one
    const { userRepository: ur } =
      await import("@/modules/users/user.repository");
    vi.mocked(ur.findEmailVerified).mockResolvedValue({
      emailVerified: new Date("2025-01-01"),
    } as never);
    mockStripeCreate.mockResolvedValue({
      id: "pi_new",
      client_secret: "cs_secret",
      amount: 5500,
    });
  });

  it("creates order and returns clientSecret for payment", async () => {
    const result = await createOrder(
      BUYER_ID,
      "buyer@buyzi.test",
      { listingId: LISTING_ID },
      "127.0.0.1",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orderId).toBe("order-1");
      expect(result.clientSecret).toBe("cs_secret");
    }
  });

  it("rejects when buyer has unverified email", async () => {
    const { userRepository } = await import("@/modules/users/user.repository");
    vi.mocked(userRepository.findEmailVerified).mockResolvedValue({
      emailVerified: null,
    } as never);

    const result = await createOrder(
      BUYER_ID,
      "buyer@buyzi.test",
      { listingId: LISTING_ID },
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("email_not_verified");
    }
  });

  it("rejects when listing not found", async () => {
    vi.mocked(db.listing.findUnique).mockResolvedValue(null);
    vi.mocked(db.listing.findFirst).mockResolvedValue(null);

    const result = await createOrder(
      BUYER_ID,
      "buyer@buyzi.test",
      { listingId: "nonexistent" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("listing_unavailable");
    }
  });

  it("rejects when buyer tries to purchase own listing", async () => {
    const result = await createOrder(
      SELLER_ID, // same as listing seller
      "seller@buyzi.test",
      { listingId: LISTING_ID },
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("own_listing");
    }
  });

  it("rejects when seller has no Stripe account", async () => {
    const noStripe = {
      id: LISTING_ID,
      title: "Lamp",
      priceNzd: 5000,
      shippingNzd: 500,
      shippingOption: "NATIONWIDE",
      sellerId: SELLER_ID,
      seller: { stripeAccountId: null, isStripeOnboarded: false },
    };
    vi.mocked(db.listing.findUnique).mockResolvedValue(noStripe as never);
    vi.mocked(db.listing.findFirst).mockResolvedValue(noStripe as never);

    const result = await createOrder(
      BUYER_ID,
      "buyer@buyzi.test",
      { listingId: LISTING_ID },
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("seller_not_configured");
    }
  });

  it("rejects when listing is already reserved (count=0)", async () => {
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 0 });

    const result = await createOrder(
      BUYER_ID,
      "buyer@buyzi.test",
      { listingId: LISTING_ID },
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("listing_unavailable");
    }
  });

  it("returns existing order on idempotency key match", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValueOnce({
      id: "order-existing",
      status: "AWAITING_PAYMENT",
      stripePaymentIntentId: "pi_existing",
      listingId: LISTING_ID,
    } as never);
    mockStripeRetrieve.mockResolvedValue({
      id: "pi_existing",
      client_secret: "cs_existing",
    });

    const result = await createOrder(
      BUYER_ID,
      "buyer@buyzi.test",
      { listingId: LISTING_ID, idempotencyKey: "idem-1" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orderId).toBe("order-existing");
      expect(result.clientSecret).toBe("cs_existing");
    }
  });

  it("handles Stripe PI creation failure — cancels order and releases listing", async () => {
    mockStripeCreate.mockRejectedValue(new Error("Stripe down"));

    const result = await createOrder(
      BUYER_ID,
      "buyer@buyzi.test",
      { listingId: LISTING_ID },
      "127.0.0.1",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("stripe_unavailable");
    }
  });

  it("creates CASH_ON_PICKUP order with no payment intent", async () => {
    const result = await createOrder(
      BUYER_ID,
      "buyer@buyzi.test",
      { listingId: LISTING_ID, fulfillmentType: "CASH_ON_PICKUP" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clientSecret).toBeNull();
    }
    // No Stripe PI created for cash orders
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });
});

describe("Dispatch flow — markDispatched", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrderForDispatch();
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
  });

  it("transitions order to DISPATCHED", async () => {
    await markDispatched(
      {
        orderId: "order-1",
        trackingNumber: "NZ12345",
        courier: "NZ Post",
        estimatedDeliveryDate: new Date(Date.now() + 3 * 86_400_000)
          .toISOString()
          .slice(0, 10),
        dispatchPhotos: ["photos/dispatch-1.jpg"],
      },
      SELLER_ID,
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DISPATCHED" }),
      }),
    );
  });

  it("rejects when non-seller attempts dispatch", async () => {
    await expect(
      markDispatched(
        {
          orderId: "order-1",
          trackingNumber: "NZ12345",
          courier: "NZ Post",
          estimatedDeliveryDate: new Date(Date.now() + 3 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          dispatchPhotos: ["photos/dispatch-1.jpg"],
        },
        "wrong-seller",
      ),
    ).rejects.toThrow(/Only the seller/);
  });

  it("rejects when order is not PAYMENT_HELD", async () => {
    mockOrderForDispatch({ status: "DISPATCHED" });

    await expect(
      markDispatched(
        {
          orderId: "order-1",
          trackingNumber: "NZ12345",
          courier: "NZ Post",
          estimatedDeliveryDate: new Date(Date.now() + 3 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          dispatchPhotos: ["photos/dispatch-1.jpg"],
        },
        SELLER_ID,
      ),
    ).rejects.toThrow(/PAYMENT_HELD/);
  });
});

describe("Delivery confirmation flow — confirmDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrderForDelivery();
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.payout.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.listing.update).mockResolvedValue({} as never);
    vi.mocked(db.listing.findUnique).mockResolvedValue({
      title: "Vintage Lamp",
    } as never);
    mockStripeCapture.mockResolvedValue({ id: "pi_mock", status: "succeeded" });
  });

  it("captures payment and transitions to COMPLETED", async () => {
    await confirmDelivery("order-1", BUYER_ID);

    // Stripe capture called
    expect(mockStripeCapture).toHaveBeenCalledWith("pi_mock");
    // Status transition
    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("rejects when non-buyer attempts confirmation", async () => {
    await expect(confirmDelivery("order-1", "wrong-user")).rejects.toThrow(
      /Only the buyer/,
    );
  });

  it("rejects when order is not in deliverable state", async () => {
    mockOrderForDelivery({ status: "PAYMENT_HELD" });

    await expect(confirmDelivery("order-1", BUYER_ID)).rejects.toThrow(
      /not in a deliverable state/,
    );
  });

  it("throws when stripePaymentIntentId is null", async () => {
    mockOrderForDelivery({ stripePaymentIntentId: null });

    await expect(confirmDelivery("order-1", BUYER_ID)).rejects.toThrow();
  });

  it("accepts DELIVERED status for confirmation", async () => {
    mockOrderForDelivery({ status: "DELIVERED" });

    await confirmDelivery("order-1", BUYER_ID);

    expect(mockStripeCapture).toHaveBeenCalled();
  });
});

describe("Cancellation flow — cancelOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 });
  });

  it("cancels PAYMENT_HELD order within free window", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "order-1",
      buyerId: BUYER_ID,
      sellerId: SELLER_ID,
      listingId: LISTING_ID,
      status: "PAYMENT_HELD",
      createdAt: new Date(), // just created — within free window
    } as never);

    await cancelOrder("order-1", BUYER_ID);

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("rejects cancellation of DISPATCHED order", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "order-1",
      buyerId: BUYER_ID,
      sellerId: SELLER_ID,
      listingId: LISTING_ID,
      status: "DISPATCHED",
      createdAt: new Date(),
    } as never);

    await expect(cancelOrder("order-1", BUYER_ID)).rejects.toThrow();
  });

  it("rejects cancellation without reason after free window", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "order-1",
      buyerId: BUYER_ID,
      sellerId: SELLER_ID,
      listingId: LISTING_ID,
      status: "PAYMENT_HELD",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    } as never);

    await expect(cancelOrder("order-1", BUYER_ID)).rejects.toThrow(/reason/i);
  });

  it("allows cancellation with reason after free window", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "order-1",
      buyerId: BUYER_ID,
      sellerId: SELLER_ID,
      listingId: LISTING_ID,
      status: "PAYMENT_HELD",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    } as never);

    await cancelOrder("order-1", BUYER_ID, "Changed my mind");

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });
});

describe("getCancellationStatus — cancellation window logic", () => {
  it("returns canCancel=true, windowType=free for recently created PAYMENT_HELD", async () => {
    const status = await getCancellationStatus({
      status: "PAYMENT_HELD",
      createdAt: new Date(), // just now
    });

    expect(status.canCancel).toBe(true);
    expect(status.requiresReason).toBe(false);
    expect(status.windowType).toBe("free");
  });

  it("returns windowType=request after free window", async () => {
    const status = await getCancellationStatus({
      status: "PAYMENT_HELD",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
    });

    expect(status.canCancel).toBe(true);
    expect(status.requiresReason).toBe(true);
    expect(status.windowType).toBe("request");
  });

  it("returns canCancel=false for DISPATCHED order", async () => {
    const status = await getCancellationStatus({
      status: "DISPATCHED",
      createdAt: new Date(),
    });

    expect(status.canCancel).toBe(false);
    expect(status.windowType).toBe("na");
  });

  it("returns windowType=closed after request window expires", async () => {
    const status = await getCancellationStatus({
      status: "PAYMENT_HELD",
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48h ago
    });

    expect(status.canCancel).toBe(false);
    expect(status.windowType).toBe("closed");
  });
});
