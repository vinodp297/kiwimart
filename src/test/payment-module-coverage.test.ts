// src/test/payment-module-coverage.test.ts
// ─── Tests: WebhookService — gap coverage ───────────────────────────────────
// Covers: handleAmountCapturableUpdated full flow, pickup path, idempotent skip,
//         handlePaymentIntentFailed reservation release & skip,
//         processEvent handler error → deleteStripeEvent for retry.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";
import type { Stripe } from "stripe";

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
    },
  };
});

// ── Mock order-event service ────────────────────────────────────────────────
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    PAYMENT_HELD: "PAYMENT_HELD",
    CANCELLED: "CANCELLED",
    DISPATCHED: "DISPATCHED",
  },
  ACTOR_ROLES: { SYSTEM: "SYSTEM", BUYER: "BUYER", SELLER: "SELLER" },
}));

// ── Lazy imports (after mocks) ──────────────────────────────────────────────
const { WebhookService } = await import("@/modules/payments/webhook.service");
const webhookService = new WebhookService();
const { listingRepository } =
  await import("@/modules/listings/listing.repository");
const { audit } = await import("@/server/lib/audit");
const { orderEventService } =
  await import("@/modules/orders/order-event.service");

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent(
  type: string,
  data: Record<string, unknown> = {},
  id = "evt_coverage_001",
): Stripe.Event {
  return {
    id,
    type,
    data: {
      object: {
        id: "pi_test",
        metadata: {
          orderId: "order-1",
          sellerId: "seller-1",
          listingId: "listing-1",
        },
        amount: 5000,
        application_fee_amount: 500,
        status: "requires_capture",
        last_payment_error: null,
        ...data,
      },
    },
    object: "event",
    api_version: "2025-01-01",
    created: Date.now() / 1000,
    livemode: false,
    pending_webhooks: 0,
    request: null,
  } as unknown as Stripe.Event;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("WebhookService — payment-module-coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: new event (not duplicate)
    vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never);
    // Default: order in AWAITING_PAYMENT + SHIPPING
    vi.mocked(db.order.findUnique).mockResolvedValue({
      status: "AWAITING_PAYMENT",
      fulfillmentType: "SHIPPING",
    } as never);
    // Default: transition succeeds
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 1. handleAmountCapturableUpdated — full shipped flow
  // ═════════════════════════════════════════════════════════════════════════

  describe("handleAmountCapturableUpdated — shipped order full flow", () => {
    it("transitions to PAYMENT_HELD and creates payout via tx.payout.upsert", async () => {
      const event = makeEvent("payment_intent.amount_capturable_updated");

      await webhookService.processEvent(event);

      // Order transitioned to PAYMENT_HELD
      expect(db.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "order-1" }),
          data: expect.objectContaining({ status: "PAYMENT_HELD" }),
        }),
      );

      // Payout created for shipped order
      expect(db.payout.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: "order-1" },
          create: expect.objectContaining({
            orderId: "order-1",
            userId: "seller-1",
            amountNzd: 5000 - 500, // amount - application_fee_amount
            platformFeeNzd: 500,
            stripeFeeNzd: 0,
            status: "PENDING",
          }),
        }),
      );
    });

    it("calls audit with PAYMENT_COMPLETED action inside the transaction", async () => {
      const event = makeEvent("payment_intent.amount_capturable_updated");

      await webhookService.processEvent(event);

      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PAYMENT_COMPLETED",
          entityType: "Order",
          entityId: "order-1",
          metadata: expect.objectContaining({
            stripePaymentIntentId: "pi_test",
            amountNzd: 5000,
            trigger: "amount_capturable_updated",
            targetStatus: "PAYMENT_HELD",
          }),
        }),
      );
    });

    it("records PAYMENT_HELD order event with escrow summary", async () => {
      const event = makeEvent("payment_intent.amount_capturable_updated");

      await webhookService.processEvent(event);

      expect(orderEventService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: "order-1",
          type: "PAYMENT_HELD",
          actorId: null,
          actorRole: "SYSTEM",
          summary: "Payment authorized and held in escrow",
          metadata: expect.objectContaining({
            stripePaymentIntentId: "pi_test",
            trigger: "amount_capturable_updated",
            targetStatus: "PAYMENT_HELD",
          }),
        }),
      );
    });

    it("runs transition, payout, audit, and event inside $transaction", async () => {
      const event = makeEvent("payment_intent.amount_capturable_updated");

      await webhookService.processEvent(event);

      // $transaction should have been called (the callback executes all ops)
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2. handleAmountCapturableUpdated — pickup order
  // ═════════════════════════════════════════════════════════════════════════

  describe("handleAmountCapturableUpdated — pickup order", () => {
    beforeEach(() => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        status: "AWAITING_PAYMENT",
        fulfillmentType: "ONLINE_PAYMENT_PICKUP",
      } as never);
    });

    it("transitions to AWAITING_PICKUP instead of PAYMENT_HELD", async () => {
      const event = makeEvent("payment_intent.amount_capturable_updated");

      await webhookService.processEvent(event);

      expect(db.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "AWAITING_PICKUP" }),
        }),
      );
    });

    it("does NOT create a payout record", async () => {
      const event = makeEvent("payment_intent.amount_capturable_updated");

      await webhookService.processEvent(event);

      expect(db.payout.upsert).not.toHaveBeenCalled();
    });

    it("records event with pickup-specific summary", async () => {
      const event = makeEvent("payment_intent.amount_capturable_updated");

      await webhookService.processEvent(event);

      expect(orderEventService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: "Payment authorized — awaiting pickup arrangement",
          metadata: expect.objectContaining({
            targetStatus: "AWAITING_PICKUP",
          }),
        }),
      );
    });

    it("audits with targetStatus AWAITING_PICKUP", async () => {
      const event = makeEvent("payment_intent.amount_capturable_updated");

      await webhookService.processEvent(event);

      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            targetStatus: "AWAITING_PICKUP",
          }),
        }),
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3. handleAmountCapturableUpdated — idempotent skip
  // ═════════════════════════════════════════════════════════════════════════

  describe("handleAmountCapturableUpdated — idempotent skip", () => {
    it("skips when order is already PAYMENT_HELD", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        status: "PAYMENT_HELD",
        fulfillmentType: "SHIPPING",
      } as never);

      const event = makeEvent("payment_intent.amount_capturable_updated");
      await webhookService.processEvent(event);

      expect(db.$transaction).not.toHaveBeenCalled();
      expect(db.order.updateMany).not.toHaveBeenCalled();
      expect(db.payout.upsert).not.toHaveBeenCalled();
    });

    it("skips when order is COMPLETED", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        status: "COMPLETED",
        fulfillmentType: "SHIPPING",
      } as never);

      const event = makeEvent("payment_intent.amount_capturable_updated");
      await webhookService.processEvent(event);

      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("skips when order is CANCELLED", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        status: "CANCELLED",
        fulfillmentType: "SHIPPING",
      } as never);

      const event = makeEvent("payment_intent.amount_capturable_updated");
      await webhookService.processEvent(event);

      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("skips when order is not found (null)", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(null);

      const event = makeEvent("payment_intent.amount_capturable_updated");
      await webhookService.processEvent(event);

      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("returns early when sellerId is missing from metadata", async () => {
      const event = makeEvent("payment_intent.amount_capturable_updated", {
        metadata: { orderId: "order-1" },
      });

      await webhookService.processEvent(event);

      expect(db.order.findUnique).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4. handlePaymentIntentFailed — releases listing reservation
  // ═════════════════════════════════════════════════════════════════════════

  describe("handlePaymentIntentFailed — listing reservation release", () => {
    it("cancels order and releases listing reservation when listingId present", async () => {
      const event = makeEvent("payment_intent.payment_failed", {
        metadata: {
          orderId: "order-fail-1",
          sellerId: "seller-1",
          listingId: "listing-42",
        },
        last_payment_error: { code: "card_declined" },
      });

      await webhookService.processEvent(event);

      // Order cancelled
      expect(db.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "CANCELLED" }),
        }),
      );

      // Listing reservation released after transaction
      expect(listingRepository.releaseReservation).toHaveBeenCalledWith(
        "listing-42",
      );
    });

    it("does NOT release reservation when listingId is absent", async () => {
      const event = makeEvent("payment_intent.payment_failed", {
        metadata: { orderId: "order-fail-2", sellerId: "seller-1" },
        last_payment_error: { code: "card_declined" },
      });

      await webhookService.processEvent(event);

      expect(db.order.updateMany).toHaveBeenCalled();
      expect(listingRepository.releaseReservation).not.toHaveBeenCalled();
    });

    it("audits PAYMENT_FAILED with failure code", async () => {
      const event = makeEvent("payment_intent.payment_failed", {
        last_payment_error: { code: "insufficient_funds" },
      });

      await webhookService.processEvent(event);

      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PAYMENT_FAILED",
          entityType: "Order",
          entityId: "order-1",
          metadata: expect.objectContaining({
            failureCode: "insufficient_funds",
          }),
        }),
      );
    });

    it("records CANCELLED order event with failure reason", async () => {
      const event = makeEvent("payment_intent.payment_failed", {
        last_payment_error: { code: "card_declined" },
      });

      await webhookService.processEvent(event);

      expect(orderEventService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: "order-1",
          type: "CANCELLED",
          actorRole: "SYSTEM",
          summary: expect.stringContaining("card_declined"),
        }),
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5. handlePaymentIntentFailed — skips when not AWAITING_PAYMENT
  // ═════════════════════════════════════════════════════════════════════════

  describe("handlePaymentIntentFailed — skip when not AWAITING_PAYMENT", () => {
    it("skips when order is PAYMENT_HELD (no transition, no release)", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        status: "PAYMENT_HELD",
        fulfillmentType: "SHIPPING",
      } as never);

      const event = makeEvent("payment_intent.payment_failed");

      await webhookService.processEvent(event);

      expect(db.$transaction).not.toHaveBeenCalled();
      expect(db.order.updateMany).not.toHaveBeenCalled();
      expect(listingRepository.releaseReservation).not.toHaveBeenCalled();
    });

    it("skips when order is not found (null)", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(null);

      const event = makeEvent("payment_intent.payment_failed");

      await webhookService.processEvent(event);

      expect(db.$transaction).not.toHaveBeenCalled();
      expect(db.order.updateMany).not.toHaveBeenCalled();
    });

    it("skips when order is already CANCELLED", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        status: "CANCELLED",
        fulfillmentType: "SHIPPING",
      } as never);

      const event = makeEvent("payment_intent.payment_failed");

      await webhookService.processEvent(event);

      expect(db.$transaction).not.toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6. processEvent — handler-first AT-LEAST-ONCE delivery
  //    Handler runs FIRST; event is recorded AFTER success.
  //    If the handler throws, the event is NOT recorded → Stripe can retry.
  // ═════════════════════════════════════════════════════════════════════════

  describe("processEvent — handler error: event not recorded, Stripe can retry", () => {
    it("does not record stripe event when handler throws, then re-throws", async () => {
      // Handler will fail: transition throws
      vi.mocked(db.order.updateMany).mockRejectedValue(
        new Error("DB connection lost"),
      );

      const event = makeEvent(
        "payment_intent.amount_capturable_updated",
        {},
        "evt_retry_001",
      );

      await expect(webhookService.processEvent(event)).rejects.toThrow(
        "DB connection lost",
      );

      // Event must NOT be recorded — Stripe must be allowed to retry
      expect(db.stripeEvent.create).not.toHaveBeenCalled();
    });

    it("re-throws original handler error without recording the event", async () => {
      vi.mocked(db.order.updateMany).mockRejectedValue(
        new Error("Handler boom"),
      );

      const event = makeEvent(
        "payment_intent.amount_capturable_updated",
        {},
        "evt_retry_002",
      );

      await expect(webhookService.processEvent(event)).rejects.toThrow(
        "Handler boom",
      );

      expect(db.stripeEvent.create).not.toHaveBeenCalled();
    });

    it("does not record event on payment_intent.succeeded handler failure", async () => {
      vi.mocked(db.order.updateMany).mockRejectedValue(
        new Error("Transition failed"),
      );

      const event = makeEvent("payment_intent.succeeded", {}, "evt_retry_003");

      await expect(webhookService.processEvent(event)).rejects.toThrow(
        "Transition failed",
      );

      expect(db.stripeEvent.create).not.toHaveBeenCalled();
    });

    it("does not record event on payment_intent.payment_failed handler failure", async () => {
      vi.mocked(db.order.updateMany).mockRejectedValue(
        new Error("Cancel failed"),
      );

      const event = makeEvent(
        "payment_intent.payment_failed",
        {},
        "evt_retry_004",
      );

      await expect(webhookService.processEvent(event)).rejects.toThrow(
        "Cancel failed",
      );

      expect(db.stripeEvent.create).not.toHaveBeenCalled();
    });
  });
});
