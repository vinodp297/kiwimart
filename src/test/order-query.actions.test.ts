// src/test/order-query.actions.test.ts
// ─── Tests: Order Query Server Actions ──────────────────────────────────────
// Covers fetchOrderDetail and getOrderTimeline.
// Satisfies coverage for orderDetail.ts + orderEvents.ts shim re-exports.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock order repository ─────────────────────────────────────────────────────
const mockFindForOrderDetail = vi.fn();
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findForOrderDetail: (...args: unknown[]) => mockFindForOrderDetail(...args),
  },
}));

// ── Mock interaction repository ───────────────────────────────────────────────
const mockFindOrderParties = vi.fn();
vi.mock("@/modules/orders/interaction.repository", () => ({
  interactionRepository: {
    findOrderParties: (...args: unknown[]) => mockFindOrderParties(...args),
  },
}));

// ── Mock order event service ──────────────────────────────────────────────────
const mockGetOrderTimeline = vi.fn();
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: {
    getOrderTimeline: (...args: unknown[]) => mockGetOrderTimeline(...args),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { fetchOrderDetail, getOrderTimeline } =
  await import("@/server/actions/order-query.actions");

// Shim re-exports (exercise them too for coverage)
const { fetchOrderDetail: fetchOrderDetailShim } =
  await import("@/server/actions/orderDetail");
const { getOrderTimeline: getOrderTimelineShim } =
  await import("@/server/actions/orderEvents");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_BUYER = { id: "user_buyer", email: "b@test.com", isAdmin: false };
const TEST_SELLER = { id: "user_seller", email: "s@test.com", isAdmin: false };
const TEST_OTHER = { id: "user_other", email: "o@test.com", isAdmin: false };
const TEST_ADMIN = { id: "user_admin", email: "a@test.com", isAdmin: true };

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order_1",
    listingId: "listing_1",
    buyerId: TEST_BUYER.id,
    sellerId: TEST_SELLER.id,
    status: "PAYMENT_HELD",
    itemNzd: 5_000,
    shippingNzd: 500,
    totalNzd: 5_500,
    createdAt: new Date("2026-04-01T10:00:00Z"),
    dispatchedAt: null,
    deliveredAt: null,
    completedAt: null,
    trackingNumber: null,
    trackingUrl: null,
    dispute: null,
    cancelledBy: null,
    cancelReason: null,
    cancelledAt: null,
    fulfillmentType: "SHIPPING",
    pickupStatus: null,
    pickupScheduledAt: null,
    pickupWindowExpiresAt: null,
    otpExpiresAt: null,
    rescheduleCount: 0,
    listing: {
      title: "Test Widget",
      images: [{ r2Key: "listings/u/1.webp" }],
    },
    buyer: { displayName: "Buyer Name", username: "buyeruser" },
    seller: { displayName: "Seller Name", username: "selleruser" },
    reviews: [],
    payout: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchOrderDetail
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchOrderDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_BUYER);
    mockFindForOrderDetail.mockResolvedValue(makeOrder());
  });

  it("unauthenticated → returns safe error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await fetchOrderDetail("order_1");

    expect(result.success).toBe(false);
    expect(mockFindForOrderDetail).not.toHaveBeenCalled();
  });

  it("order not found → returns Order not found error", async () => {
    mockFindForOrderDetail.mockResolvedValueOnce(null);

    const result = await fetchOrderDetail("order_missing");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/order not found/i);
    }
  });

  it("user is not buyer or seller → returns permission error", async () => {
    mockRequireUser.mockResolvedValueOnce(TEST_OTHER);

    const result = await fetchOrderDetail("order_1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/permission/i);
    }
  });

  it("happy path (buyer) → maps prices to dollars and exposes isBuyer", async () => {
    const result = await fetchOrderDetail("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isBuyer).toBe(true);
      expect(result.data.itemPrice).toBe(50);
      expect(result.data.shippingPrice).toBe(5);
      expect(result.data.total).toBe(55);
      expect(result.data.status).toBe("payment_held");
      // Other-party for buyer == seller
      expect(result.data.otherPartyUsername).toBe("selleruser");
    }
  });

  it("happy path (seller) → isBuyer false and shows buyer as other party", async () => {
    mockRequireUser.mockResolvedValueOnce(TEST_SELLER);

    const result = await fetchOrderDetail("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isBuyer).toBe(false);
      expect(result.data.otherPartyUsername).toBe("buyeruser");
    }
  });

  it("falls back to lowercase status when status not in STATUS_MAP", async () => {
    mockFindForOrderDetail.mockResolvedValueOnce(
      makeOrder({ status: "CUSTOM_STATUS" }),
    );

    const result = await fetchOrderDetail("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("custom_status");
    }
  });

  it("dispute block present → maps all dispute fields to ISO strings", async () => {
    mockFindForOrderDetail.mockResolvedValueOnce(
      makeOrder({
        dispute: {
          reason: "NOT_AS_DESCRIBED",
          status: "OPEN",
          buyerStatement: "Item broken",
          sellerStatement: null,
          openedAt: new Date("2026-04-05T10:00:00Z"),
          sellerRespondedAt: null,
          resolvedAt: null,
        },
      }),
    );

    const result = await fetchOrderDetail("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dispute).not.toBeNull();
      expect(result.data.dispute?.reason).toBe("NOT_AS_DESCRIBED");
      expect(result.data.dispute?.openedAt).toBe("2026-04-05T10:00:00.000Z");
    }
  });

  it("reviews flag hasBuyerReview vs hasSellerReview correctly", async () => {
    mockFindForOrderDetail.mockResolvedValueOnce(
      makeOrder({
        reviews: [{ reviewerRole: "BUYER" }],
      }),
    );

    const result = await fetchOrderDetail("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasReview).toBe(true);
      expect(result.data.hasBuyerReview).toBe(true);
      expect(result.data.hasSellerReview).toBe(false);
    }
  });

  it("payout exposed to seller and net payout = amount - fees", async () => {
    mockRequireUser.mockResolvedValueOnce(TEST_SELLER);
    mockFindForOrderDetail.mockResolvedValueOnce(
      makeOrder({
        payout: {
          status: "PAID",
          amountNzd: 5_500,
          platformFeeNzd: 500,
          stripeFeeNzd: 100,
        },
      }),
    );

    const result = await fetchOrderDetail("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payout).not.toBeNull();
      expect(result.data.payout?.sellerPayoutNzd).toBe(4_900);
    }
  });

  it("payout hidden from buyer even when present", async () => {
    mockFindForOrderDetail.mockResolvedValueOnce(
      makeOrder({
        payout: {
          status: "PAID",
          amountNzd: 5_500,
          platformFeeNzd: 500,
          stripeFeeNzd: 100,
        },
      }),
    );

    const result = await fetchOrderDetail("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payout).toBeNull();
    }
  });

  it("repository throws → returns safe fallback", async () => {
    mockFindForOrderDetail.mockRejectedValueOnce(new Error("DB offline"));

    const result = await fetchOrderDetail("order_1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/couldn't load|refresh/i);
      // Must not leak raw DB error
      expect(result.error).not.toMatch(/DB offline/);
    }
  });

  it("orderDetail.ts shim re-exports fetchOrderDetail", async () => {
    const result = await fetchOrderDetailShim("order_1");

    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getOrderTimeline
// ─────────────────────────────────────────────────────────────────────────────

describe("getOrderTimeline", () => {
  const sampleEvent = {
    id: "evt_1",
    type: "ORDER_CREATED",
    actorRole: "BUYER",
    summary: "Order placed",
    metadata: { foo: "bar" },
    createdAt: new Date("2026-04-01T10:00:00Z"),
    actor: { displayName: "Buyer Name", username: "buyeruser" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_BUYER);
    mockFindOrderParties.mockResolvedValue({
      buyerId: TEST_BUYER.id,
      sellerId: TEST_SELLER.id,
    });
    mockGetOrderTimeline.mockResolvedValue([sampleEvent]);
  });

  it("unauthenticated → returns safe error and does not query events", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await getOrderTimeline("order_1");

    expect(result.success).toBe(false);
    expect(mockGetOrderTimeline).not.toHaveBeenCalled();
  });

  it("order not found → returns Order not found error", async () => {
    mockFindOrderParties.mockResolvedValueOnce(null);

    const result = await getOrderTimeline("order_missing");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/order not found|could not load/i);
    }
  });

  it("non-party, non-admin → returns access error", async () => {
    mockRequireUser.mockResolvedValueOnce(TEST_OTHER);

    const result = await getOrderTimeline("order_1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/access|could not load/i);
    }
  });

  it("admin (non-party) → allowed and returns events", async () => {
    mockRequireUser.mockResolvedValueOnce(TEST_ADMIN);

    const result = await getOrderTimeline("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
    }
  });

  it("buyer party → returns mapped events with ISO createdAt", async () => {
    const result = await getOrderTimeline("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]).toMatchObject({
        id: "evt_1",
        type: "ORDER_CREATED",
        actorRole: "BUYER",
        summary: "Order placed",
        createdAt: "2026-04-01T10:00:00.000Z",
      });
      expect(result.data[0].actor?.username).toBe("buyeruser");
    }
  });

  it("seller party → also allowed", async () => {
    mockRequireUser.mockResolvedValueOnce(TEST_SELLER);

    const result = await getOrderTimeline("order_1");

    expect(result.success).toBe(true);
  });

  it("event with null actor → maps actor as null in output", async () => {
    mockGetOrderTimeline.mockResolvedValueOnce([
      { ...sampleEvent, actor: null },
    ]);

    const result = await getOrderTimeline("order_1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].actor).toBeNull();
    }
  });

  it("event service throws → returns generic timeline error", async () => {
    mockGetOrderTimeline.mockRejectedValueOnce(new Error("Event store down"));

    const result = await getOrderTimeline("order_1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/could not load order timeline/i);
      expect(result.error).not.toMatch(/Event store down/);
    }
  });

  it("orderEvents.ts shim re-exports getOrderTimeline", async () => {
    const result = await getOrderTimelineShim("order_1");

    expect(result.success).toBe(true);
  });
});
