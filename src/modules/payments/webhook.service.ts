// src/modules/payments/webhook.service.ts
// ─── Webhook Event Processing Service ────────────────────────────────────────
// Handles Stripe webhook events. Framework-free — no Next.js imports.
//
// Idempotency strategy: AT-LEAST-ONCE with idempotent handlers.
//   1. Handler runs FIRST — if it throws, event is NOT marked processed,
//      so Stripe retries will re-deliver it.
//   2. Handler is idempotent via transitionOrder() optimistic locking —
//      a second delivery harmlessly gets P2025 (count=0).
//   3. AFTER handler succeeds, markEventProcessed() records the event ID.
//      Duplicate check (P2002) short-circuits future deliveries.
//
// Previous pattern (mark BEFORE handle) was at-most-once — a handler failure
// after marking permanently skipped the event, leaving orders stuck.

import type { Stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";
import { audit } from "@/server/lib/audit";
import { orderRepository } from "@/modules/orders/order.repository";
import { userRepository } from "@/modules/users/user.repository";
import { listingRepository } from "@/modules/listings/listing.repository";
import { transitionOrder } from "@/modules/orders/order.transitions";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
export class WebhookService {
  /**
   * Race-safe idempotency: try to insert, catch unique constraint violation.
   * Returns true if this is a new event, false if already processed.
   */
  async markEventProcessed(eventId: string, type: string): Promise<boolean> {
    try {
      await orderRepository.createStripeEvent(eventId, type);
      return true;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        logger.info("stripe.webhook.duplicate", { eventId, type });
        return false;
      }
      throw err;
    }
  }

  async processEvent(event: Stripe.Event): Promise<void> {
    // Duplicate check FIRST — skip if already successfully processed
    const isNew = await this.markEventProcessed(event.id, event.type);
    if (!isNew) return;

    // Handler runs AFTER duplicate check. If the handler throws, the event
    // row is already inserted, so we delete it in the catch to allow Stripe
    // retries. Handlers are idempotent (optimistic locking) so re-delivery
    // is safe.
    try {
      switch (event.type) {
        case "payment_intent.amount_capturable_updated":
          await this.handleAmountCapturableUpdated(event);
          break;

        case "payment_intent.succeeded":
          await this.handlePaymentIntentSucceeded(event);
          break;

        case "payment_intent.payment_failed":
          await this.handlePaymentIntentFailed(event);
          break;

        case "account.updated":
          await this.handleAccountUpdated(event);
          break;

        case "transfer.created":
          await this.handleTransferCreated(event);
          break;

        default:
          break;
      }
    } catch (handlerError) {
      // Handler failed — DELETE the event record so Stripe retry is not
      // blocked by the idempotency check. The handler is idempotent so
      // re-processing on retry is safe.
      try {
        await orderRepository.deleteStripeEvent(event.id);
      } catch {
        // If delete also fails, the event is stuck as "processed".
        // The daily reconciliation cron will detect the mismatch.
        logger.error("webhook.event.rollback_failed", {
          eventId: event.id,
          type: event.type,
        });
      }
      throw handlerError;
    }
  }

  /**
   * Handles payment_intent.amount_capturable_updated — fires when the customer
   * completes payment on a capture_method: 'manual' PaymentIntent.
   * The PI is now in 'requires_capture' (funds authorized, not yet captured).
   * Transitions the order from AWAITING_PAYMENT → PAYMENT_HELD (escrow).
   */
  private async handleAmountCapturableUpdated(
    event: Stripe.Event,
  ): Promise<void> {
    const pi = event.data.object as Stripe.PaymentIntent;
    const orderId = pi.metadata?.orderId;
    const sellerId = pi.metadata?.sellerId;
    if (!orderId || !sellerId) return;

    // Only transition from AWAITING_PAYMENT — prevents replayed webhooks from
    // reverting orders already past the escrow stage.
    const currentOrder = await orderRepository.findForWebhookStatus(orderId);

    if (currentOrder?.status !== "AWAITING_PAYMENT") {
      logger.info(
        "webhook.amount_capturable_updated: already past AWAITING_PAYMENT",
        {
          orderId,
          currentStatus: currentOrder?.status ?? "NOT_FOUND",
          eventId: event.id,
          stripePaymentIntentId: pi.id,
        },
      );
      return; // Idempotent — already transitioned (possibly by a retry)
    }

    // For pickup orders, transition to AWAITING_PICKUP instead of PAYMENT_HELD.
    // Payment is authorized but NOT captured — capture happens on OTP confirmation
    // or buyer no-show (handled by pickup worker).
    const isPickupOrder =
      currentOrder.fulfillmentType === "ONLINE_PAYMENT_PICKUP";
    const targetStatus = isPickupOrder ? "AWAITING_PICKUP" : "PAYMENT_HELD";

    await orderRepository.$transaction(async (tx) => {
      await transitionOrder(
        orderId,
        targetStatus,
        { updatedAt: new Date() },
        { tx, fromStatus: currentOrder.status },
      );
      if (!isPickupOrder) {
        // Payout created immediately for shipped orders;
        // for pickup orders, payout is created on OTP confirmation.
        // Store the gross order amount as the payout base. The payout worker
        // will deduct platform + Stripe fees when it initiates the transfer.
        // application_fee_amount is 0 in our current implementation because we
        // use manual transfers (Model B) rather than destination charges — Stripe
        // does not collect a fee on our behalf.
        await tx.payout.upsert({
          where: { orderId },
          create: {
            orderId,
            userId: sellerId,
            amountNzd: pi.amount - (pi.application_fee_amount ?? 0),
            platformFeeNzd: pi.application_fee_amount ?? 0,
            stripeFeeNzd: 0,
            status: "PENDING",
          },
          update: {},
        });
      }

      // CRITICAL: audit and event inside the transaction so they roll back
      // atomically if the transition or payout creation fails.
      await audit({
        action: "PAYMENT_COMPLETED",
        entityType: "Order",
        entityId: orderId,
        metadata: {
          stripePaymentIntentId: pi.id,
          amountNzd: pi.amount,
          trigger: "amount_capturable_updated",
          targetStatus,
        },
        tx,
      });

      await orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.PAYMENT_HELD,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: isPickupOrder
          ? "Payment authorized — awaiting pickup arrangement"
          : "Payment authorized and held in escrow",
        metadata: {
          stripePaymentIntentId: pi.id,
          trigger: "amount_capturable_updated",
          targetStatus,
        },
        tx,
      });
    });

    logger.info(
      `webhook.amount_capturable_updated: order moved to ${targetStatus}`,
      {
        orderId,
        stripePaymentIntentId: pi.id,
      },
    );
  }

  private async handlePaymentIntentSucceeded(
    event: Stripe.Event,
  ): Promise<void> {
    const pi = event.data.object as Stripe.PaymentIntent;
    const orderId = pi.metadata?.orderId;
    const sellerId = pi.metadata?.sellerId;
    if (!orderId || !sellerId) return;

    // State validation: only transition from AWAITING_PAYMENT to PAYMENT_HELD.
    // Prevents replayed webhooks from reverting completed/refunded orders.
    const currentOrder = await orderRepository.findForWebhookStatus(orderId);

    if (currentOrder?.status !== "AWAITING_PAYMENT") {
      logger.warn("webhook.payment_intent_succeeded: unexpected order state", {
        orderId,
        currentStatus: currentOrder?.status ?? "NOT_FOUND",
        eventId: event.id,
        stripePaymentIntentId: pi.id,
      });
      return; // Return without error — Stripe should not retry this
    }

    await orderRepository.$transaction(async (tx) => {
      await transitionOrder(
        orderId,
        "PAYMENT_HELD",
        { updatedAt: new Date() },
        { tx, fromStatus: currentOrder.status },
      );
      // Gross order amount stored as payout base. Fee deduction happens in
      // the payout worker when the Stripe transfer is initiated.
      await tx.payout.upsert({
        where: { orderId },
        create: {
          orderId,
          userId: sellerId,
          amountNzd: pi.amount - (pi.application_fee_amount ?? 0),
          platformFeeNzd: pi.application_fee_amount ?? 0,
          stripeFeeNzd: 0,
          status: "PENDING",
        },
        update: {},
      });

      // CRITICAL: audit and event inside the transaction so they roll back
      // atomically if the transition or payout creation fails.
      await audit({
        action: "PAYMENT_COMPLETED",
        entityType: "Order",
        entityId: orderId,
        metadata: { stripePaymentIntentId: pi.id, amountNzd: pi.amount },
        tx,
      });

      await orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.PAYMENT_HELD,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: "Payment authorized and held in escrow",
        metadata: {
          stripePaymentIntentId: pi.id,
          trigger: "payment_intent_succeeded",
        },
        tx,
      });
    });
  }

  private async handlePaymentIntentFailed(event: Stripe.Event): Promise<void> {
    const pi = event.data.object as Stripe.PaymentIntent;
    const orderId = pi.metadata?.orderId;
    if (!orderId) return;

    // Fetch current status — only cancel AWAITING_PAYMENT orders.
    // Guards against replayed webhooks reverting orders already past payment.
    const currentOrder = await orderRepository.findForWebhookStatus(orderId);

    if (!currentOrder || currentOrder.status !== "AWAITING_PAYMENT") {
      logger.warn("webhook.payment_intent_failed: unexpected order state", {
        orderId,
        currentStatus: currentOrder?.status ?? "NOT_FOUND",
        eventId: event.id,
      });
      return;
    }

    await orderRepository.$transaction(async (tx) => {
      await transitionOrder(
        orderId,
        "CANCELLED",
        {},
        { tx, fromStatus: currentOrder.status },
      );

      // CRITICAL: audit and event inside the transaction so they roll back
      // atomically if the transition fails.
      await audit({
        action: "PAYMENT_FAILED",
        entityType: "Order",
        entityId: orderId,
        metadata: {
          stripePaymentIntentId: pi.id,
          failureCode: pi.last_payment_error?.code,
        },
        tx,
      });

      await orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.CANCELLED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: `Order cancelled: payment failed${pi.last_payment_error?.code ? ` (${pi.last_payment_error.code})` : ""}`,
        metadata: {
          trigger: "PAYMENT_FAILED",
          failureCode: pi.last_payment_error?.code,
        },
        tx,
      });
    });

    // Release listing reservation so other buyers can purchase it.
    // Guard: only release if still RESERVED — never overwrite SOLD/ACTIVE.
    const listingId = pi.metadata?.listingId;
    if (listingId) {
      await listingRepository.releaseReservation(listingId);
    }
  }

  private async handleAccountUpdated(event: Stripe.Event): Promise<void> {
    const account = event.data.object as Stripe.Account;
    const onboarded =
      account.details_submitted === true &&
      account.charges_enabled === true &&
      account.payouts_enabled === true;

    await userRepository.updateByStripeAccountId(account.id, {
      isStripeOnboarded: onboarded,
      isStripeChargesEnabled: account.charges_enabled ?? false,
      isStripePayoutsEnabled: account.payouts_enabled ?? false,
    });
  }

  private async handleTransferCreated(event: Stripe.Event): Promise<void> {
    const transfer = event.data.object as Stripe.Transfer;
    await orderRepository.updatePayoutByTransferId(transfer.id);
  }
}

export const webhookService = new WebhookService();
