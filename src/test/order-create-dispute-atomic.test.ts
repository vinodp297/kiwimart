// src/test/order-create-dispute-atomic.test.ts
// ─── Atomic tx threading: order creation and dispute opening ──────────────────
// Verifies that the recordEvent calls for ORDER_CREATED, order CANCELLED
// (invalid Connect account), and DISPUTE_OPENED are executed inside the
// same $transaction as the writes they belong to.
//
// Tests per spec:
//   1. ORDER_CREATED event: recordEvent called with tx
//   2. If event write fails → order creation transaction rolls back
//   3. DISPUTE_OPENED event: recordEvent called with tx
//   4. If event write fails → dispute creation rolls back
//   5. No orphaned order without ORDER_CREATED event (same tx = same commit)
//   6. No orphaned dispute without DISPUTE_OPENED event (same tx = same commit)

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Module-level mock handles (must be declared before vi.mock factories) ─────
const mockTxFn = vi.fn();

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    findListingForOrder: vi.fn(),
    reserveListing: vi.fn().mockResolvedValue({ count: 1 }),
    releaseListing: vi.fn().mockResolvedValue({ count: 1 }),
    createInTx: vi.fn(),
    setStripePaymentIntentId: vi.fn().mockResolvedValue({}),
    findStripePaymentIntentId: vi.fn().mockResolvedValue(null),
    findByIdForDispute: vi.fn(),
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTxFn(fn),
  },
  DbClient: {},
}));

vi.mock("@/modules/orders/order-event.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/modules/orders/order-event.service")
    >();
  return {
    ...actual,
    orderEventService: {
      recordEvent: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/listing-snapshot.service", () => ({
  captureListingSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findEmailVerified: vi
      .fn()
      .mockResolvedValue({ emailVerified: new Date("2025-01-01") }),
  },
}));

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    createPaymentIntent: vi.fn().mockResolvedValue({
      paymentIntentId: "pi_test_123",
      clientSecret: "cs_test_123",
    }),
    getClientSecret: vi.fn().mockResolvedValue("cs_test"),
    capturePayment: vi.fn().mockResolvedValue(undefined),
    refundPayment: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    paymentIntents: {
      cancel: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/modules/orders/order-create-helpers", () => ({
  handleCashOnPickup: vi.fn(),
  notifyOrderCreated: vi.fn(),
  schedulePickupDeadline: vi.fn(),
}));

vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));

vi.mock("@/server/services/dispute/dispute.service", () => ({
  createDispute: vi.fn().mockResolvedValue({ id: "dispute-1" }),
  getDisputeByOrderId: vi.fn().mockResolvedValue(null),
  setAutoResolving: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

vi.mock("@/server/email", () => ({
  sendDisputeOpenedEmail: vi.fn().mockResolvedValue(undefined),
  sendReturnRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendDataExportEmail: vi.fn().mockResolvedValue(undefined),
  sendErasureConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendAdminIdVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { createOrder } from "@/modules/orders/order-create.service";
import { openDispute } from "@/modules/orders/order-dispute.service";
import { orderRepository } from "@/modules/orders/order.repository";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
} from "@/modules/orders/order-event.service";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = "buyer-atomic-1";
const USER_EMAIL = "buyer@example.com";
const LISTING_ID = "listing-atomic-1";
const ORDER_ID = "order-atomic-1";
const IP = "127.0.0.1";

/** A well-formed listing with a valid Stripe account — triggers ORDER_CREATED path */
const GOOD_LISTING = {
  id: LISTING_ID,
  title: "Test Camera",
  priceNzd: 10000,
  shippingNzd: 500,
  shippingOption: "SHIPPED",
  sellerId: "seller-atomic-1",
  seller: {
    stripeAccountId: "acct_1TestAccount00001",
    isStripeOnboarded: true,
    displayName: "Test Seller",
    email: "seller@example.com",
  },
};

/** A listing with an invalid Stripe account — triggers INVALID_CONNECT_ACCOUNT path */
const BAD_CONNECT_LISTING = {
  ...GOOD_LISTING,
  seller: {
    ...GOOD_LISTING.seller,
    stripeAccountId: "not-a-real-account-id",
  },
};

const MOCK_ORDER = { id: ORDER_ID };

const OPEN_DISPUTE_INPUT = {
  orderId: ORDER_ID,
  reason: "ITEM_NOT_RECEIVED" as const,
  description: "I never received the item after 3 weeks.",
  evidenceUrls: [],
};

const DISPUTED_ORDER = {
  id: ORDER_ID,
  buyerId: USER_ID,
  sellerId: "seller-atomic-1",
  status: "DISPATCHED",
  fulfillmentType: "SHIPPED",
  disputeOpenedAt: null,
  dispatchedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
  listing: { title: "Test Camera" },
  buyer: { displayName: "Test Buyer" },
  seller: { displayName: "Test Seller", email: "seller@example.com" },
};

// ─────────────────────────────────────────────────────────────────────────────

describe("createOrder — ORDER_CREATED event inside transaction (D-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderRepository.findListingForOrder).mockResolvedValue(
      GOOD_LISTING as never,
    );

    // First $transaction call creates the order row — return the order object.
    // Second $transaction call sets PI ID + records ORDER_CREATED event.
    let callCount = 0;
    mockTxFn.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        callCount += 1;
        if (callCount === 1) {
          // First tx: create order in DB
          vi.mocked(orderRepository.createInTx).mockResolvedValue(
            MOCK_ORDER as never,
          );
          return fn({ _isMockTx: "first" });
        }
        // Second tx: setStripePaymentIntentId + recordEvent
        return fn({ _isMockTx: "second" });
      },
    );
  });

  // ── Test 1: recordEvent called with tx in second transaction ───────────────
  it("recordEvent(ORDER_CREATED) receives the transaction client", async () => {
    const result = await createOrder(
      USER_ID,
      USER_EMAIL,
      { listingId: LISTING_ID },
      IP,
    );

    expect(result.ok).toBe(true);
    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.ORDER_CREATED,
        tx: expect.objectContaining({ _isMockTx: "second" }),
      }),
    );
  });

  // ── Test 2: recordEvent and setStripePaymentIntentId share the same tx ─────
  it("setStripePaymentIntentId and recordEvent(ORDER_CREATED) use the same tx", async () => {
    const capturedTx: unknown[] = [];

    mockTxFn.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        // We don't know which call this is at factory time, so track per-call tx
        const tx = { _isMockTx: Symbol("tx") };
        vi.mocked(orderRepository.setStripePaymentIntentId).mockImplementation(
          async (_id, _piId, capturedBySet) => {
            capturedTx.push(capturedBySet);
            return {} as never;
          },
        );
        vi.mocked(
          orderEventService.recordEvent as ReturnType<typeof vi.fn>,
        ).mockImplementation(async (input: { tx?: unknown; type?: string }) => {
          if (input.type === ORDER_EVENT_TYPES.ORDER_CREATED) {
            capturedTx.push(input.tx);
          }
        });
        vi.mocked(orderRepository.createInTx).mockResolvedValue(
          MOCK_ORDER as never,
        );
        return fn(tx);
      },
    );

    await createOrder(USER_ID, USER_EMAIL, { listingId: LISTING_ID }, IP);

    // Both writes must have been captured
    expect(capturedTx).toHaveLength(2);
    // And they must be the same tx object (same transaction)
    expect(capturedTx[0]).toBe(capturedTx[1]);
  });

  // ── Test 3: recordEvent error propagates (rolls back in production) ─────────
  it("ORDER_CREATED event failure propagates from the transaction", async () => {
    let callCount = 0;
    mockTxFn.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        callCount += 1;
        if (callCount === 1) {
          vi.mocked(orderRepository.createInTx).mockResolvedValue(
            MOCK_ORDER as never,
          );
          return fn({ _isMockTx: "first" });
        }
        // Second tx: make recordEvent throw
        vi.mocked(
          orderEventService.recordEvent as ReturnType<typeof vi.fn>,
        ).mockRejectedValueOnce(new Error("orderEvent.create DB failure"));
        return fn({ _isMockTx: "second" });
      },
    );

    // createOrder wraps in try/catch and returns ok:false on error
    const result = await createOrder(
      USER_ID,
      USER_EMAIL,
      { listingId: LISTING_ID },
      IP,
    );

    // The outer catch translates the transaction failure into a user-facing error
    expect(result.ok).toBe(false);
  });

  // ── Test 5: PI ID and event are committed together ─────────────────────────
  // (correlates to "no orphaned order without ORDER_CREATED event")
  it("setStripePaymentIntentId is called before recordEvent in the same tx boundary", async () => {
    const callOrder: string[] = [];

    let callCount = 0;
    mockTxFn.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        callCount += 1;
        if (callCount === 1) {
          vi.mocked(orderRepository.createInTx).mockResolvedValue(
            MOCK_ORDER as never,
          );
          return fn({ _isMockTx: "first" });
        }
        vi.mocked(orderRepository.setStripePaymentIntentId).mockImplementation(
          async () => {
            callOrder.push("setPiId");
            return {} as never;
          },
        );
        vi.mocked(
          orderEventService.recordEvent as ReturnType<typeof vi.fn>,
        ).mockImplementation(async (input: { type?: string }) => {
          if (input.type === ORDER_EVENT_TYPES.ORDER_CREATED) {
            callOrder.push("recordEvent");
          }
        });
        return fn({ _isMockTx: "second" });
      },
    );

    const result = await createOrder(
      USER_ID,
      USER_EMAIL,
      { listingId: LISTING_ID },
      IP,
    );

    expect(result.ok).toBe(true);
    // setStripePaymentIntentId must precede recordEvent inside the same tx
    expect(callOrder).toEqual(["setPiId", "recordEvent"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("createOrder — CANCELLED event inside transaction (invalid Connect account)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderRepository.findListingForOrder).mockResolvedValue(
      BAD_CONNECT_LISTING as never,
    );

    let callCount = 0;
    mockTxFn.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        callCount += 1;
        if (callCount === 1) {
          vi.mocked(orderRepository.createInTx).mockResolvedValue(
            MOCK_ORDER as never,
          );
          return fn({ _isMockTx: "create" });
        }
        // Second tx: cancel + event
        return fn({ _isMockTx: "cancel" });
      },
    );
  });

  it("recordEvent(CANCELLED) for invalid Connect account receives the transaction client", async () => {
    const result = await createOrder(
      USER_ID,
      USER_EMAIL,
      { listingId: LISTING_ID },
      IP,
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "seller_not_configured" });
    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.CANCELLED,
        tx: expect.objectContaining({ _isMockTx: "cancel" }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("openDispute — DISPUTE_OPENED event inside transaction (D-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(orderRepository.findByIdForDispute).mockResolvedValue(
      DISPUTED_ORDER as never,
    );

    mockTxFn.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ _isMockTx: true }),
    );
  });

  // ── Test 3: recordEvent(DISPUTE_OPENED) called with tx ─────────────────────
  it("recordEvent(DISPUTE_OPENED) receives the transaction client", async () => {
    await openDispute(OPEN_DISPUTE_INPUT, USER_ID, IP);

    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ORDER_EVENT_TYPES.DISPUTE_OPENED,
        tx: expect.objectContaining({ _isMockTx: true }),
      }),
    );
  });

  // ── Test 4: recordEvent failure propagates (rolls back in production) ───────
  it("DISPUTE_OPENED event failure propagates from the transaction", async () => {
    mockTxFn.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        vi.mocked(
          orderEventService.recordEvent as ReturnType<typeof vi.fn>,
        ).mockRejectedValueOnce(new Error("orderEvent.create DB failure"));
        return fn({ _isMockTx: true });
      },
    );

    await expect(openDispute(OPEN_DISPUTE_INPUT, USER_ID, IP)).rejects.toThrow(
      "orderEvent.create DB failure",
    );
  });

  // ── Test 6: no orphaned dispute without DISPUTE_OPENED event ───────────────
  it("createDispute and recordEvent(DISPUTE_OPENED) share the same tx object", async () => {
    const capturedTx: unknown[] = [];
    const { createDispute } =
      await import("@/server/services/dispute/dispute.service");

    vi.mocked(createDispute).mockImplementation(async (params) => {
      capturedTx.push(params.tx);
      return { id: "dispute-1" } as never;
    });

    vi.mocked(
      orderEventService.recordEvent as ReturnType<typeof vi.fn>,
    ).mockImplementation(async (input: { tx?: unknown }) => {
      capturedTx.push(input.tx);
    });

    await openDispute(OPEN_DISPUTE_INPUT, USER_ID, IP);

    // Both createDispute and recordEvent must have received a tx
    expect(capturedTx).toHaveLength(2);
    expect(capturedTx[0]).toBeDefined();
    // Both must be the same transaction client
    expect(capturedTx[0]).toBe(capturedTx[1]);
  });

  // ── Structural guard: $transaction is called exactly once ──────────────────
  it("openDispute uses exactly one $transaction for transition + dispute + event", async () => {
    await openDispute(OPEN_DISPUTE_INPUT, USER_ID, IP);

    expect(mockTxFn).toHaveBeenCalledOnce();
  });
});
