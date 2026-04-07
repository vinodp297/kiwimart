// src/test/orderCreate-cashPayout.test.ts
// ─── Tests: CASH_ON_PICKUP payout creation at order time ────────────────────
// Verifies that createOrder creates a Payout record inside the transaction
// for CASH_ON_PICKUP orders (GAP 1 fix).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOrder } from "@/modules/orders/order-create.service";

// ─── vi.mock declarations (hoisted) ──────────────────────────────────────────

vi.mock("server-only", () => ({}));

vi.mock("@/lib/queue", () => ({
  payoutQueue: { add: vi.fn() },
  emailQueue: { add: vi.fn() },
  pickupQueue: {
    add: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  getQueueConnection: vi.fn(),
}));

vi.mock("@/modules/orders/order-create-helpers", () => ({
  handleCashOnPickup: vi.fn(),
  notifyOrderCreated: vi.fn(),
  schedulePickupDeadline: vi.fn(),
}));

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    createPaymentIntent: vi.fn().mockResolvedValue({
      paymentIntentId: "pi_mock",
      clientSecret: "cs_mock",
    }),
    getClientSecret: vi.fn().mockResolvedValue("cs_mock"),
  },
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: { ORDER_CREATED: "ORDER_CREATED" },
  ACTOR_ROLES: { BUYER: "BUYER" },
}));

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    paymentIntents: {
      cancel: vi.fn().mockResolvedValue({}),
    },
  },
}));

// ─── Mock orderRepository ───────────────────────────────────────────────────
// We mock the entire repository to control exactly what the $transaction
// callback receives, so we can track tx.payout.upsert calls.

const mockPayoutUpsert = vi.fn().mockResolvedValue({});

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    findListingForOrder: vi.fn().mockResolvedValue(null),
    reserveListing: vi.fn().mockResolvedValue({ count: 1 }),
    releaseListing: vi.fn().mockResolvedValue(undefined),
    createInTx: vi.fn().mockResolvedValue({ id: "order-new" }),
    setStripePaymentIntentId: vi.fn().mockResolvedValue(undefined),
    findStripePaymentIntentId: vi.fn().mockResolvedValue(null),
    $transaction: vi.fn().mockImplementation(async (fn: unknown) => {
      // Build a minimal tx with payout.upsert tracking
      const tx = {
        payout: { upsert: mockPayoutUpsert },
      };
      return (fn as (tx: unknown) => Promise<unknown>)(tx);
    }),
  },
}));

// ─── Test data ──────────────────────────────────────────────────────────────

const LISTING = {
  id: "listing-1",
  sellerId: "seller-1",
  priceNzd: 3000,
  shippingNzd: 500,
  shippingOption: "SHIPPED",
  title: "Test Widget",
  seller: {
    stripeAccountId: "acct_1234567890abcdef",
    isStripeOnboarded: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────

describe("createOrder — CASH_ON_PICKUP payout creation", () => {
  let orderRepository: typeof import("@/modules/orders/order.repository").orderRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPayoutUpsert.mockResolvedValue({});

    const mod = await import("@/modules/orders/order.repository");
    orderRepository = mod.orderRepository;

    vi.mocked(orderRepository.findByIdempotencyKey).mockResolvedValue(null);
    vi.mocked(orderRepository.findListingForOrder).mockResolvedValue(
      LISTING as never,
    );
    vi.mocked(orderRepository.reserveListing).mockResolvedValue({
      count: 1,
    } as never);

    // Re-apply $transaction mock (cleared by clearAllMocks)
    vi.mocked(orderRepository.$transaction).mockImplementation(
      async (fn: unknown) => {
        const tx = { payout: { upsert: mockPayoutUpsert } };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      },
    );
    vi.mocked(orderRepository.createInTx).mockResolvedValue({
      id: "order-new",
    } as never);
  });

  it("creates a PENDING Payout inside the transaction for CASH_ON_PICKUP", async () => {
    const result = await createOrder(
      "buyer-1",
      "buyer@test.com",
      { listingId: "listing-1", fulfillmentType: "CASH_ON_PICKUP" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clientSecret).toBeNull();

    // Payout.upsert was called inside the transaction
    expect(mockPayoutUpsert).toHaveBeenCalledTimes(1);
    expect(mockPayoutUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: "order-new" },
        create: expect.objectContaining({
          orderId: "order-new",
          userId: "seller-1",
          amountNzd: 3000, // priceNzd + 0 shipping for pickup
          platformFeeNzd: 0,
          stripeFeeNzd: 0,
          status: "PENDING",
        }),
      }),
    );
  });

  it("does NOT create a Payout for SHIPPED orders in the creation transaction", async () => {
    const result = await createOrder(
      "buyer-1",
      "buyer@test.com",
      { listingId: "listing-1", fulfillmentType: "SHIPPED" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(true);
    // No payout created in transaction — shipped payouts are created via Stripe webhook
    expect(mockPayoutUpsert).not.toHaveBeenCalled();
  });

  it("does NOT create a Payout for ONLINE_PAYMENT_PICKUP in the creation transaction", async () => {
    const result = await createOrder(
      "buyer-1",
      "buyer@test.com",
      { listingId: "listing-1", fulfillmentType: "ONLINE_PAYMENT_PICKUP" },
      "127.0.0.1",
    );

    expect(result.ok).toBe(true);
    // Online pickup payouts are created via Stripe webhook, not at order time
    expect(mockPayoutUpsert).not.toHaveBeenCalled();
  });
});
