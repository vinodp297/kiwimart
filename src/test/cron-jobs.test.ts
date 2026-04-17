// src/test/cron-jobs.test.ts
// ─── Integration tests for all six cron job handlers ─────────────────────────
// Covers: deliveryReminders, stripeReconciliation, priceDropNotifications,
// sellerDowngradeCheck, dispatchReminders, disputeAutoResolve.

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { createNotification } from "@/modules/notifications/notification.service";
import { orderEventService } from "@/modules/orders/order-event.service";
import {
  notifyBuyerDeliveryOverdue,
  notifySellerDispatchReminder,
} from "@/lib/smartNotifications";
import { calculateSellerTier } from "@/lib/seller-tiers.server";
import { getConfigFloat, getConfigInt } from "@/lib/platform-config";
import { audit } from "@/server/lib/audit";
import { autoResolutionService } from "@/modules/disputes/auto-resolution.service";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { paymentService } from "@/modules/payments/payment.service";
import { stripe } from "@/infrastructure/stripe/client";

// ── Additional mocks not in global setup ─────────────────────────────────────

vi.mock("server-only", () => ({}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    DELIVERY_REMINDER_SENT: "DELIVERY_REMINDER_SENT",
    AUTO_COMPLETED: "AUTO_COMPLETED",
    AUTO_RESOLVED: "AUTO_RESOLVED",
    INTERACTION_EXPIRED: "INTERACTION_EXPIRED",
    ORDER_CREATED: "ORDER_CREATED",
    CANCELLED: "CANCELLED",
    DISPATCHED: "DISPATCHED",
  },
  ACTOR_ROLES: { SYSTEM: "SYSTEM", BUYER: "BUYER", SELLER: "SELLER" },
}));

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    capturePayment: vi.fn().mockResolvedValue({ id: "pi_captured" }),
    refundPayment: vi.fn().mockResolvedValue({ id: "re_mock" }),
  },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/smartNotifications", () => ({
  notifyBuyerDeliveryOverdue: vi.fn(),
  notifySellerDispatchReminder: vi.fn(),
}));

vi.mock("@/lib/platform-config", () => ({
  CONFIG_KEYS: {
    FREE_CANCEL_WINDOW_MINUTES: "FREE_CANCEL_WINDOW_MINUTES",
    SELLER_DOWNGRADE_DISPUTE_RATE_PCT: "SELLER_DOWNGRADE_DISPUTE_RATE_PCT",
    SELLER_DOWNGRADE_OPEN_DISPUTES: "SELLER_DOWNGRADE_OPEN_DISPUTES",
    DISPUTE_SELLER_RESPONSE_HOURS: "DISPUTE_SELLER_RESPONSE_HOURS",
    PICKUP_MIN_LEAD_TIME_HOURS: "PICKUP_MIN_LEAD_TIME_HOURS",
    PICKUP_MAX_HORIZON_DAYS: "PICKUP_MAX_HORIZON_DAYS",
    PICKUP_WINDOW_MINUTES: "PICKUP_WINDOW_MINUTES",
    PICKUP_RESCHEDULE_RESPONSE_HOURS: "PICKUP_RESCHEDULE_RESPONSE_HOURS",
    PICKUP_RESCHEDULE_LIMIT: "PICKUP_RESCHEDULE_LIMIT",
    PICKUP_OTP_EXPIRY_MINUTES: "PICKUP_OTP_EXPIRY_MINUTES",
  },
  getConfigFloat: vi.fn().mockResolvedValue(5),
  getConfigInt: vi.fn().mockResolvedValue(3),
  getConfigMany: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/seller-tiers.server", () => ({
  calculateSellerTier: vi.fn().mockResolvedValue("GOLD"),
}));

vi.mock("@/modules/disputes/auto-resolution.service", () => ({
  autoResolutionService: {
    evaluateDispute: vi.fn().mockResolvedValue({
      decision: "AUTO_REFUND",
      score: 80,
      factors: [],
      recommendation: "Refund buyer",
      coolingPeriodHours: 24,
      canAutoResolve: true,
    }),
    executeDecision: vi.fn().mockResolvedValue(undefined),
    queueAutoResolution: vi.fn().mockResolvedValue(undefined),
  },
  RESOLUTION_WEIGHTS: { COOLING_PERIOD_HOURS: 24 },
}));

vi.mock("@/modules/orders/order.service", () => ({
  orderService: { openDispute: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    paymentIntents: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      retrieve: vi
        .fn()
        .mockResolvedValue({ id: "pi_test", status: "succeeded" }),
    },
  },
}));

// ── Patch missing Prisma models onto the mocked db ────────────────────────────

const _db = db as unknown as Record<string, unknown>;

if (!_db.orderEvent) {
  _db.orderEvent = {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "evt-1" }),
    update: vi.fn().mockResolvedValue({}),
  };
}
if (!_db.notification) {
  _db.notification = {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "notif-1" }),
  };
}
if (!_db.orderInteraction) {
  _db.orderInteraction = {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
}

// watchlistItem.update is not included in setup.ts
(db.watchlistItem as unknown as Record<string, unknown>).update = vi
  .fn()
  .mockResolvedValue({});

// ── Lazy service imports (after all vi.mock declarations) ─────────────────────

let processDeliveryReminders: (typeof import("@/server/jobs/deliveryReminders"))["processDeliveryReminders"];
let runStripeReconciliation: (typeof import("@/server/jobs/stripeReconciliation"))["runStripeReconciliation"];
let checkPriceDrops: (typeof import("@/server/jobs/priceDropNotifications"))["checkPriceDrops"];
let runSellerDowngradeCheck: (typeof import("@/server/jobs/sellerDowngradeCheck"))["runSellerDowngradeCheck"];
let sendDispatchReminders: (typeof import("@/server/jobs/dispatchReminders"))["sendDispatchReminders"];
let processDisputeAutoResolution: (typeof import("@/server/jobs/disputeAutoResolve"))["processDisputeAutoResolution"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgoMs(d: number) {
  return Date.now() - d * 24 * 60 * 60 * 1000;
}
function hoursAgoMs(h: number) {
  return Date.now() - h * 60 * 60 * 1000;
}

function makeDispatchedOrder(id = "order-1") {
  return {
    id,
    buyerId: "buyer-1",
    sellerId: "seller-1",
    totalNzd: 5000,
    stripePaymentIntentId: "pi_test123",
    dispatchedAt: new Date(daysAgoMs(5)),
    listing: { title: "Test Item", id: "listing-1" },
    buyer: { email: "buyer@test.com", displayName: "Test Buyer" },
  };
}

function makeDispatchEvent(orderId: string, daysAgo: number) {
  return {
    id: `evt-dispatch-${orderId}`,
    orderId,
    type: "DISPATCHED",
    metadata: {
      estimatedDeliveryDate: new Date(daysAgoMs(daysAgo)).toISOString(),
    },
  };
}

function makeReminderEvent(orderId: string) {
  return {
    id: `evt-reminder-${orderId}`,
    orderId,
    type: "DELIVERY_REMINDER_SENT",
    metadata: {},
  };
}

function makeQueuedAutoResolveEvent(orderId: string, executeInPast = true) {
  const executeAt = new Date(
    executeInPast ? hoursAgoMs(1) : Date.now() + 60 * 60 * 1000,
  );
  return {
    id: "evt-queued-1",
    orderId,
    createdAt: new Date(hoursAgoMs(25)),
    metadata: {
      status: "QUEUED",
      executeAt: executeAt.toISOString(),
      decision: "AUTO_REFUND",
      score: 80,
      factors: [],
      recommendation: "Refund buyer",
    },
  };
}

function mockTransaction() {
  vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
    if (typeof fn === "function") {
      return (fn as (tx: typeof db) => Promise<unknown>)(db);
    }
    return [];
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Cron Jobs", () => {
  beforeAll(async () => {
    const delivMod = await import("@/server/jobs/deliveryReminders");
    processDeliveryReminders = delivMod.processDeliveryReminders;

    const reconcMod = await import("@/server/jobs/stripeReconciliation");
    runStripeReconciliation = reconcMod.runStripeReconciliation;

    const priceMod = await import("@/server/jobs/priceDropNotifications");
    checkPriceDrops = priceMod.checkPriceDrops;

    const downMod = await import("@/server/jobs/sellerDowngradeCheck");
    runSellerDowngradeCheck = downMod.runSellerDowngradeCheck;

    const dispMod = await import("@/server/jobs/dispatchReminders");
    sendDispatchReminders = dispMod.sendDispatchReminders;

    const disputeMod = await import("@/server/jobs/disputeAutoResolve");
    processDisputeAutoResolution = disputeMod.processDisputeAutoResolution;
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // $transaction must always be set — not defined in setup.ts factory
    mockTransaction();

    // Restore implementations cleared by clearAllMocks on selected critical mocks
    vi.mocked(createNotification).mockResolvedValue(undefined);
    vi.mocked(paymentService.capturePayment).mockResolvedValue({
      id: "pi_captured",
    } as never);
    vi.mocked(transitionOrder).mockResolvedValue(undefined as never);
    vi.mocked(calculateSellerTier).mockResolvedValue("GOLD" as never);
    vi.mocked(getConfigFloat).mockResolvedValue(5);
    vi.mocked(getConfigInt).mockResolvedValue(3);
    vi.mocked(autoResolutionService.executeDecision).mockResolvedValue(
      undefined,
    );
    vi.mocked(autoResolutionService.queueAutoResolution).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(autoResolutionService.evaluateDispute).mockResolvedValue({
      decision: "AUTO_REFUND",
      score: 80,
      factors: [],
      recommendation: "Refund buyer",
      coolingPeriodHours: 24,
      canAutoResolve: true,
    } as never);
    vi.mocked(stripe.paymentIntents.list).mockResolvedValue({
      data: [],
    } as never);
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValue({
      id: "pi_test",
      status: "succeeded",
    } as never);

    // Default db models to return empty results
    vi.mocked(db.order.findMany).mockResolvedValue([] as never);
    vi.mocked(db.user.findMany).mockResolvedValue([] as never);
    vi.mocked(db.watchlistItem.findMany).mockResolvedValue([] as never);
    vi.mocked(db.order.update).mockResolvedValue({} as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);
    vi.mocked(db.listing.update).mockResolvedValue({} as never);
    vi.mocked(db.payout.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 } as never);

    // Reset patched model mocks to their defaults
    const oe = _db.orderEvent as Record<string, ReturnType<typeof vi.fn>>;
    oe.findMany!.mockResolvedValue([]);
    oe.update!.mockResolvedValue({});

    const notif = _db.notification as Record<string, ReturnType<typeof vi.fn>>;
    notif.findMany!.mockResolvedValue([]);

    const oi = _db.orderInteraction as Record<string, ReturnType<typeof vi.fn>>;
    oi.findMany!.mockResolvedValue([]);
    oi.updateMany!.mockResolvedValue({ count: 0 });

    (db.watchlistItem as unknown as Record<string, unknown>).update = vi
      .fn()
      .mockResolvedValue({});
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. DELIVERY REMINDERS
  // ──────────────────────────────────────────────────────────────────────────

  describe("1. Delivery Reminders", () => {
    it("sends reminder for order dispatched 3+ days past estimated delivery", async () => {
      vi.mocked(db.order.findMany).mockResolvedValue([
        makeDispatchedOrder(),
      ] as never);
      // DISPATCHED event says estimatedDelivery was 4 days ago; no reminder sent yet
      (
        _db.orderEvent as Record<string, ReturnType<typeof vi.fn>>
      ).findMany!.mockResolvedValue([makeDispatchEvent("order-1", 4)] as never);

      const result = await processDeliveryReminders();

      expect(result.remindersSent).toBe(1);
      expect(notifyBuyerDeliveryOverdue).toHaveBeenCalledWith(
        "buyer-1",
        "order-1",
        "Test Item",
        expect.any(Number),
      );
    });

    it("does not send duplicate reminder when one was already sent", async () => {
      vi.mocked(db.order.findMany).mockResolvedValue([
        makeDispatchedOrder(),
      ] as never);
      // Both a DISPATCHED event and a DELIVERY_REMINDER_SENT event exist
      (
        _db.orderEvent as Record<string, ReturnType<typeof vi.fn>>
      ).findMany!.mockResolvedValue([
        makeDispatchEvent("order-1", 4),
        makeReminderEvent("order-1"),
      ] as never);

      const result = await processDeliveryReminders();

      expect(result.remindersSent).toBe(0);
      expect(notifyBuyerDeliveryOverdue).not.toHaveBeenCalled();
    });

    it("skips orders with no estimated delivery date in dispatch event", async () => {
      vi.mocked(db.order.findMany).mockResolvedValue([
        makeDispatchedOrder(),
      ] as never);
      // DISPATCHED event has no estimatedDeliveryDate in metadata
      (
        _db.orderEvent as Record<string, ReturnType<typeof vi.fn>>
      ).findMany!.mockResolvedValue([
        {
          id: "evt-1",
          orderId: "order-1",
          type: "DISPATCHED",
          metadata: {}, // no estimatedDeliveryDate
        },
      ] as never);

      const result = await processDeliveryReminders();

      expect(result.remindersSent).toBe(0);
      expect(notifyBuyerDeliveryOverdue).not.toHaveBeenCalled();
    });

    it("returns correct count of reminders sent across multiple orders", async () => {
      const orders = [
        makeDispatchedOrder("order-1"),
        makeDispatchedOrder("order-2"),
        makeDispatchedOrder("order-3"),
      ];
      vi.mocked(db.order.findMany).mockResolvedValue(orders as never);
      // All three have DISPATCHED events 4 days ago, none have reminder events
      (
        _db.orderEvent as Record<string, ReturnType<typeof vi.fn>>
      ).findMany!.mockResolvedValue([
        makeDispatchEvent("order-1", 4),
        makeDispatchEvent("order-2", 4),
        makeDispatchEvent("order-3", 4),
      ] as never);

      const result = await processDeliveryReminders();

      expect(result.remindersSent).toBe(3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. STRIPE RECONCILIATION
  // ──────────────────────────────────────────────────────────────────────────

  describe("2. Stripe Reconciliation", () => {
    it("auto-fixes AWAITING_PAYMENT order to PAYMENT_HELD when Stripe PI is requires_capture", async () => {
      // Check 1: findAwaitingPaymentWithPiOlderThan → returns stale order
      vi.mocked(db.order.findMany)
        .mockResolvedValueOnce([
          {
            id: "order-1",
            stripePaymentIntentId: "pi_abc123",
            listingId: "listing-1",
          },
        ] as never)
        // Check 2: findPaymentHeldWithPiOlderThan → no stale held orders
        .mockResolvedValueOnce([] as never);

      vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValue({
        id: "pi_abc123",
        status: "requires_capture",
      } as never);

      await runStripeReconciliation();

      expect(transitionOrder).toHaveBeenCalledWith(
        "order-1",
        "PAYMENT_HELD",
        {},
        { fromStatus: "AWAITING_PAYMENT" },
      );
      expect(logger.info).toHaveBeenCalledWith(
        "stripe.reconciliation.fixed_awaiting_to_payment_held",
        expect.objectContaining({ orderId: "order-1" }),
      );
    });

    it("does not auto-fix when no stale AWAITING_PAYMENT orders exist", async () => {
      // Both checks return no orders
      vi.mocked(db.order.findMany).mockResolvedValue([] as never);

      await runStripeReconciliation();

      expect(transitionOrder).not.toHaveBeenCalled();
      expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    });

    it("logs stale PAYMENT_HELD orders as requiring manual review", async () => {
      // Check 1: no awaiting orders
      vi.mocked(db.order.findMany)
        .mockResolvedValueOnce([] as never)
        // Check 3 (PI not-found scan, 1hr cutoff): no orders
        .mockResolvedValueOnce([] as never)
        // Check 2 (alert, 7-day cutoff): stale held order
        .mockResolvedValueOnce([
          { id: "order-1", stripePaymentIntentId: "pi_cancelled" },
        ] as never);

      await runStripeReconciliation();

      expect(logger.error).toHaveBeenCalledWith(
        "stripe.reconciliation.stale_payment_held",
        expect.objectContaining({
          orderId: "order-1",
          requiresManualReview: true,
        }),
      );
      // Stale held orders must NOT be auto-transitioned
      expect(transitionOrder).not.toHaveBeenCalled();
    });

    it("handles Stripe API error gracefully when retrieving PI for AWAITING_PAYMENT order", async () => {
      vi.mocked(db.order.findMany)
        .mockResolvedValueOnce([
          {
            id: "order-1",
            stripePaymentIntentId: "pi_error",
            listingId: "l-1",
          },
        ] as never)
        .mockResolvedValueOnce([] as never);

      vi.mocked(stripe.paymentIntents.retrieve).mockRejectedValue(
        new Error("Stripe network error"),
      );

      // Should not throw — error is caught per-order
      await expect(runStripeReconciliation()).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        "stripe.reconciliation.order_fix_failed",
        expect.objectContaining({ orderId: "order-1" }),
      );
    });

    it("auto-fixes AWAITING_PAYMENT order to CANCELLED and releases listing when PI is canceled", async () => {
      vi.mocked(db.order.findMany)
        .mockResolvedValueOnce([
          {
            id: "order-1",
            stripePaymentIntentId: "pi_can",
            listingId: "listing-1",
          },
        ] as never)
        .mockResolvedValueOnce([] as never);

      vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValue({
        id: "pi_can",
        status: "canceled",
      } as never);

      await runStripeReconciliation();

      expect(transitionOrder).toHaveBeenCalledWith(
        "order-1",
        "CANCELLED",
        { cancelledAt: expect.any(Date) },
        { fromStatus: "AWAITING_PAYMENT" },
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. PRICE DROP NOTIFICATIONS
  // ──────────────────────────────────────────────────────────────────────────

  describe("3. Price Drop Notifications", () => {
    it("notifies watcher when listing price has dropped below priceAtWatch", async () => {
      vi.mocked(db.watchlistItem.findMany).mockResolvedValue([
        {
          id: "watch-1",
          userId: "buyer-1",
          priceAtWatch: 10000, // was $100
          listing: { id: "listing-1", title: "Cool Lamp", priceNzd: 8000 }, // now $80
        },
      ] as never);

      const result = await checkPriceDrops();

      expect(result.notified).toBe(1);
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "buyer-1",
          listingId: "listing-1",
          title: expect.stringContaining("Price drop"),
        }),
      );
    });

    it("does not notify watcher when price has not dropped", async () => {
      vi.mocked(db.watchlistItem.findMany).mockResolvedValue([
        {
          id: "watch-1",
          userId: "buyer-1",
          priceAtWatch: 8000, // was $80
          listing: { id: "listing-1", title: "Cool Lamp", priceNzd: 8000 }, // still $80
        },
      ] as never);

      const result = await checkPriceDrops();

      expect(result.notified).toBe(0);
      expect(createNotification).not.toHaveBeenCalled();
    });

    it("updates priceAtWatch to the new price after notification", async () => {
      vi.mocked(db.watchlistItem.findMany).mockResolvedValue([
        {
          id: "watch-1",
          userId: "buyer-1",
          priceAtWatch: 10000,
          listing: { id: "listing-1", title: "Cool Lamp", priceNzd: 7500 },
        },
      ] as never);

      await checkPriceDrops();

      // $transaction is called with array of watchlistItem.update operations
      expect(db.$transaction).toHaveBeenCalled();
    });

    it("returns correct checked and notified counts", async () => {
      vi.mocked(db.watchlistItem.findMany).mockResolvedValue([
        {
          id: "watch-1",
          userId: "buyer-1",
          priceAtWatch: 10000,
          listing: { id: "listing-1", title: "Item A", priceNzd: 8000 }, // dropped
        },
        {
          id: "watch-2",
          userId: "buyer-2",
          priceAtWatch: 5000,
          listing: { id: "listing-2", title: "Item B", priceNzd: 6000 }, // no drop
        },
      ] as never);

      const result = await checkPriceDrops();

      expect(result.checked).toBe(2);
      expect(result.notified).toBe(1);
    });

    it("returns zero counts when no watchlist items have price alerts", async () => {
      vi.mocked(db.watchlistItem.findMany).mockResolvedValue([] as never);

      const result = await checkPriceDrops();

      expect(result.checked).toBe(0);
      expect(result.notified).toBe(0);
      expect(createNotification).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. SELLER DOWNGRADE CHECK
  // ──────────────────────────────────────────────────────────────────────────

  describe("4. Seller Downgrade Check", () => {
    it("downgrades GOLD seller to SILVER when dispute rate exceeds threshold", async () => {
      // getConfigFloat returns 5 (5% threshold), getConfigInt returns 3 (open disputes)
      // Seller has disputeRate 0.2 (20%) which exceeds 0.05 (5%)
      vi.mocked(db.user.findMany)
        .mockResolvedValueOnce([
          {
            id: "seller-1",
            trustMetrics: {
              completedOrders: 10,
              totalOrders: 20,
              averageRating: 3.5,
              disputeRate: 0.2,
            },
          },
        ] as never) // sellersAtRisk
        .mockResolvedValueOnce([] as never); // sellersWithOpenDisputes

      vi.mocked(calculateSellerTier).mockResolvedValue("GOLD" as never);

      const result = await runSellerDowngradeCheck();

      expect(result.downgraded).toBe(1);
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "seller-1" },
          data: expect.objectContaining({ sellerTierOverride: "SILVER" }),
        }),
      );
    });

    it("does not downgrade seller who meets all tier requirements", async () => {
      // Both queries return empty — no candidates at risk
      vi.mocked(db.user.findMany)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never);

      const result = await runSellerDowngradeCheck();

      expect(result.checked).toBe(0);
      expect(result.downgraded).toBe(0);
      expect(db.user.update).not.toHaveBeenCalled();
    });

    it("sends notification to seller on downgrade", async () => {
      vi.mocked(db.user.findMany)
        .mockResolvedValueOnce([
          {
            id: "seller-1",
            trustMetrics: {
              completedOrders: 10,
              totalOrders: 20,
              averageRating: 3.5,
              disputeRate: 0.2,
            },
          },
        ] as never)
        .mockResolvedValueOnce([] as never);

      vi.mocked(calculateSellerTier).mockResolvedValue("GOLD" as never);

      await runSellerDowngradeCheck();

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "seller-1",
          type: "SYSTEM",
          title: expect.stringContaining("seller"),
        }),
      );
    });

    it("records tier change in audit log on downgrade", async () => {
      vi.mocked(db.user.findMany)
        .mockResolvedValueOnce([
          {
            id: "seller-1",
            trustMetrics: {
              completedOrders: 10,
              totalOrders: 20,
              averageRating: 3.5,
              disputeRate: 0.2,
            },
          },
        ] as never)
        .mockResolvedValueOnce([] as never);

      vi.mocked(calculateSellerTier).mockResolvedValue("SILVER" as never);

      await runSellerDowngradeCheck();

      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "SELLER_TIER_DOWNGRADED",
          entityId: "seller-1",
          metadata: expect.objectContaining({ newTier: "BRONZE" }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. DISPATCH REMINDERS
  // ──────────────────────────────────────────────────────────────────────────

  describe("5. Dispatch Reminders", () => {
    it("sends reminder to seller for order in the 24-hour dispatch window", async () => {
      // Order created 30 hours ago — in the [24, 36) hour window
      vi.mocked(db.order.findMany).mockResolvedValue([
        {
          id: "order-1",
          sellerId: "seller-1",
          createdAt: new Date(hoursAgoMs(30)),
          listing: { title: "Test Item" },
          buyer: { displayName: "Test Buyer" },
        },
      ] as never);
      // No existing notifications — not yet notified
      (
        _db.notification as Record<string, ReturnType<typeof vi.fn>>
      ).findMany!.mockResolvedValue([] as never);

      const result = await sendDispatchReminders();

      expect(result.sent).toBe(1);
      expect(notifySellerDispatchReminder).toHaveBeenCalledWith(
        "seller-1",
        "order-1",
        "Test Buyer",
        "Test Item",
        expect.any(Number),
      );
    });

    it("does not send duplicate reminder when notification already exists within 12h", async () => {
      vi.mocked(db.order.findMany).mockResolvedValue([
        {
          id: "order-1",
          sellerId: "seller-1",
          createdAt: new Date(hoursAgoMs(30)),
          listing: { title: "Test Item" },
          buyer: { displayName: "Test Buyer" },
        },
      ] as never);
      // Existing notification already sent for this order
      (
        _db.notification as Record<string, ReturnType<typeof vi.fn>>
      ).findMany!.mockResolvedValue([{ orderId: "order-1" }] as never);

      const result = await sendDispatchReminders();

      expect(result.sent).toBe(0);
      expect(notifySellerDispatchReminder).not.toHaveBeenCalled();
    });

    it("skips orders outside the notification windows (e.g. 100 hours old)", async () => {
      // Order created 100 hours ago — outside all windows (24-36, 48-60, 72-84)
      vi.mocked(db.order.findMany).mockResolvedValue([
        {
          id: "order-1",
          sellerId: "seller-1",
          createdAt: new Date(hoursAgoMs(100)),
          listing: { title: "Test Item" },
          buyer: { displayName: "Test Buyer" },
        },
      ] as never);
      (
        _db.notification as Record<string, ReturnType<typeof vi.fn>>
      ).findMany!.mockResolvedValue([] as never);

      const result = await sendDispatchReminders();

      expect(result.sent).toBe(0);
      expect(notifySellerDispatchReminder).not.toHaveBeenCalled();
    });

    it("returns correct sent count for multiple orders in window", async () => {
      vi.mocked(db.order.findMany).mockResolvedValue([
        {
          id: "order-1",
          sellerId: "seller-1",
          createdAt: new Date(hoursAgoMs(30)), // 24h window
          listing: { title: "Item 1" },
          buyer: { displayName: "Buyer 1" },
        },
        {
          id: "order-2",
          sellerId: "seller-2",
          createdAt: new Date(hoursAgoMs(52)), // 48h window
          listing: { title: "Item 2" },
          buyer: { displayName: "Buyer 2" },
        },
      ] as never);
      (
        _db.notification as Record<string, ReturnType<typeof vi.fn>>
      ).findMany!.mockResolvedValue([] as never);

      const result = await sendDispatchReminders();

      expect(result.sent).toBe(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. DISPUTE AUTO-RESOLVE
  // ──────────────────────────────────────────────────────────────────────────

  describe("6. Dispute Auto-Resolve", () => {
    it("queues auto-resolution for unresponsive dispute (seller no response after threshold)", async () => {
      // Part 1 (cooling): no queued events
      const oe = _db.orderEvent as Record<string, ReturnType<typeof vi.fn>>;
      oe.findMany!.mockResolvedValueOnce([]) // queued AUTO_RESOLVED events (Part 1)
        .mockResolvedValueOnce([]); // already-queued check (Part 2)

      // Part 2 (unresponsive): one unresponsive dispute
      vi.mocked(db.order.findMany).mockResolvedValue([
        { id: "order-1" },
      ] as never);

      const result = await processDisputeAutoResolution();

      expect(result.unresponsiveEvaluated).toBe(1);
      expect(autoResolutionService.queueAutoResolution).toHaveBeenCalledWith(
        "order-1",
      );
    });

    it("executes cooling-period decision when no counter-evidence has been submitted", async () => {
      const oe = _db.orderEvent as Record<string, ReturnType<typeof vi.fn>>;
      // Call sequence: 1st=queued events, 2nd=DISPUTE_RESPONDED (empty=no counter-evidence), 3rd=Part2 already-queued
      oe.findMany!.mockResolvedValueOnce([
        makeQueuedAutoResolveEvent("order-1", true),
      ]) // 1st: queued events
        .mockResolvedValueOnce([]) // 2nd: DISPUTE_RESPONDED — none filed
        .mockResolvedValueOnce([]); // 3rd: Part 2 already-queued

      vi.mocked(db.order.findMany)
        .mockResolvedValueOnce([{ id: "order-1", status: "DISPUTED" }] as never) // Part 1 bulk status
        .mockResolvedValueOnce([]); // Part 2: no unresponsive disputes

      const result = await processDisputeAutoResolution();

      expect(autoResolutionService.executeDecision).toHaveBeenCalledWith(
        "order-1",
        expect.objectContaining({ decision: "AUTO_REFUND" }),
      );
      expect(result.coolingExecuted).toBe(1);
    });

    it("does not execute resolution before the cooling period expires", async () => {
      const oe = _db.orderEvent as Record<string, ReturnType<typeof vi.fn>>;
      // executeAt is in the future — cooling period not yet elapsed
      oe.findMany!.mockResolvedValueOnce([
        makeQueuedAutoResolveEvent("order-1", false),
      ]) // executeAt in future
        .mockResolvedValueOnce([]); // no unresponsive

      vi.mocked(db.order.findMany)
        .mockResolvedValueOnce([{ id: "order-1", status: "DISPUTED" }] as never)
        .mockResolvedValueOnce([]); // Part 2

      const result = await processDisputeAutoResolution();

      expect(autoResolutionService.executeDecision).not.toHaveBeenCalled();
      expect(result.coolingExecuted).toBe(0);
    });

    it("re-evaluates and escalates to admin when counter-evidence makes score inconclusive", async () => {
      const oe = _db.orderEvent as Record<string, ReturnType<typeof vi.fn>>;
      const queuedEvent = makeQueuedAutoResolveEvent("order-1", true);

      // Call sequence inside processDisputeAutoResolution Part 1:
      //   1st oe.findMany → queued AUTO_RESOLVED events
      //   [then Promise.all]:
      //     db.order.findMany  → bulk order statuses (1st db.order.findMany call)
      //     2nd oe.findMany    → DISPUTE_RESPONDED counter-evidence events
      //   3rd oe.findMany (Part 2) → already-queued AUTO_RESOLVED check
      oe.findMany!.mockResolvedValueOnce([queuedEvent]) // 1st: queued AUTO_RESOLVED events
        .mockResolvedValueOnce([
          {
            orderId: "order-1",
            createdAt: new Date(Date.now() - 60_000), // 1 min ago > 25h ago (queued event)
          },
        ]) // 2nd: DISPUTE_RESPONDED counter-evidence exists
        .mockResolvedValueOnce([]); // 3rd: Part 2 already-queued check

      vi.mocked(db.order.findMany)
        .mockResolvedValueOnce([{ id: "order-1", status: "DISPUTED" }] as never) // Part 1 bulk status
        .mockResolvedValueOnce([]); // Part 2 unresponsive disputes

      // Re-evaluation returns canAutoResolve: false → escalate to admin
      vi.mocked(autoResolutionService.evaluateDispute).mockResolvedValue({
        decision: "ESCALATE_HUMAN",
        score: 50,
        factors: [],
        recommendation: "Requires human review",
        coolingPeriodHours: 24,
        canAutoResolve: false,
      } as never);

      const result = await processDisputeAutoResolution();

      expect(autoResolutionService.evaluateDispute).toHaveBeenCalledWith(
        "order-1",
      );
      expect(autoResolutionService.executeDecision).not.toHaveBeenCalled();
      expect(result.coolingExecuted).toBe(0);
    });

    it("escalates expired OrderInteraction and records an order event", async () => {
      // Parts 1 & 2 return nothing to process
      const oe = _db.orderEvent as Record<string, ReturnType<typeof vi.fn>>;
      oe.findMany!.mockResolvedValueOnce([]) // Part 1
        .mockResolvedValueOnce([]); // Part 2 already-queued

      vi.mocked(db.order.findMany).mockResolvedValue([] as never);

      // Part 3: an expired interaction waiting to be escalated
      const oi = _db.orderInteraction as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      oi.findMany!.mockResolvedValue([
        {
          id: "interaction-1",
          orderId: "order-1",
          type: "DELIVERY_ISSUE",
          reason: "Package never arrived",
          autoAction: "AUTO_ESCALATE",
          expiresAt: new Date(Date.now() - 60_000), // already expired
          order: {
            id: "order-1",
            buyerId: "buyer-1",
            sellerId: "seller-1",
            status: "DISPATCHED",
            listing: { title: "Test Item" },
          },
          initiator: { displayName: "Test Buyer" },
        },
      ] as never);

      const result = await processDisputeAutoResolution();

      expect(result.interactionsEscalated).toBe(1);
      expect(orderEventService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: "order-1",
          type: "INTERACTION_EXPIRED",
        }),
      );
      expect(oi.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["interaction-1"] } },
          data: expect.objectContaining({ status: "ESCALATED" }),
        }),
      );
    });
  });
});
