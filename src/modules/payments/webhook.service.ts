// src/modules/payments/webhook.service.ts
// ─── Webhook Event Processing Service ────────────────────────────────────────
// Handles Stripe webhook events. Framework-free — no Next.js imports.
//
// Idempotency strategy: AT-LEAST-ONCE with idempotent handlers.
//
//   FLOW: handle FIRST → mark AFTER success
//
//   1. Run the handler. If it throws, do NOT record the event — Stripe will
//      retry and the handler will re-run. This is AT-LEAST-ONCE delivery.
//   2. Handlers are idempotent via transitionOrder() optimistic locking:
//      a concurrent delivery sees count=0 on updateMany and returns early.
//   3. After the handler succeeds, insert the event ID with a unique
//      constraint. P2002 means a concurrent delivery already recorded it —
//      harmless because step 2 made the second run a no-op.
//
// Previous pattern (mark BEFORE handle, delete on failure) was broken:
//   - Delete rollback had a race window: concurrent delivery B sees the row,
//     skips, then delivery A's rollback deletes it → event permanently lost.
//   - AT-MOST-ONCE with a broken rollback = silent payment failures.

import type { Stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";
import { audit } from "@/server/lib/audit";
import { orderRepository } from "@/modules/orders/order.repository";
import { userRepository } from "@/modules/users/user.repository";
import { listingRepository } from "@/modules/listings/listing.repository";
import { payoutRepository } from "@/modules/payments/payout.repository";
import { disputeRepository } from "@/modules/disputes/dispute.repository";
import { transitionOrder } from "@/modules/orders/order.transitions";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { fireAndForget } from "@/lib/fire-and-forget";
import { createNotification } from "@/modules/notifications/notification.service";
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
    // ── Redis idempotency is handled exclusively by the route handler ─────
    // The former service-level Redis fast-path (24 h TTL, different key prefix)
    // has been removed to eliminate duplicate idempotency namespaces.
    //
    // Authoritative idempotency layers:
    //   1. Route: Redis GET/SET  webhook:stripe:{id}  TTL 72 h  (performance)
    //   2. Here : DB unique constraint via markEventProcessed()  (ground truth)
    //
    // Run the handler FIRST. If it throws, the event is not recorded and
    // Stripe will retry — AT-LEAST-ONCE delivery. Handlers must be idempotent.
    //
    // The switch discriminant is cast to string so that handlers can be added
    // for event types Stripe adds before the SDK types are updated, without
    // introducing lint errors. Each handler does its own safe cast of
    // event.data.object to the appropriate Stripe type.
    try {
      switch (event.type as string) {
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

        case "charge.refunded":
          await this.handleChargeRefunded(event);
          break;

        case "charge.dispute.created":
          await this.handleChargeDisputeCreated(event);
          break;

        case "charge.dispute.closed":
          await this.handleChargeDisputeClosed(event);
          break;

        case "payout.failed":
          await this.handlePayoutFailed(event);
          break;

        case "transfer.failed":
          await this.handleTransferFailed(event);
          break;

        case "transfer.reversed":
          await this.handleTransferReversed(event);
          break;

        case "payment_intent.canceled":
          await this.handlePaymentIntentCanceled(event);
          break;

        default:
          logger.warn("webhook.unhandled_event_type", {
            eventType: event.type,
            eventId: event.id,
          });
          break;
      }
    } catch (handlerError) {
      // Handler failed — do NOT record the event. Stripe will retry and the
      // handler will re-run. No rollback needed because nothing was written.
      logger.error("stripe.webhook.handler_failed", {
        eventId: event.id,
        type: event.type,
        error:
          handlerError instanceof Error
            ? handlerError.message
            : String(handlerError),
      });
      throw handlerError;
    }

    // Mark as processed AFTER the handler succeeds. P2002 means a concurrent
    // delivery already recorded the event — harmless because the handler ran
    // idempotently (optimistic locking made the second delivery a no-op).
    const isNew = await this.markEventProcessed(event.id, event.type);
    if (!isNew) {
      logger.info("stripe.webhook.concurrent_duplicate", {
        eventId: event.id,
        type: event.type,
        note: "Handler ran idempotently; concurrent delivery already recorded this event",
      });
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

  /**
   * charge.refunded — Stripe issued a refund (via dashboard, dispute, or API).
   * Transitions the order to REFUNDED if it is in an active escrow state.
   */
  private async handleChargeRefunded(event: Stripe.Event): Promise<void> {
    const charge = event.data.object as Stripe.Charge;
    const piId = charge.payment_intent as string | null;
    if (!piId) return;

    const order = await orderRepository.findByStripePaymentIntentId(piId);
    if (!order) {
      logger.warn("webhook.charge_refunded.order_not_found", {
        eventId: event.id,
        paymentIntentId: piId,
      });
      return;
    }

    // Only refundable from active escrow states — terminal states are no-ops.
    const refundableStatuses = ["PAYMENT_HELD", "DISPATCHED", "DELIVERED"];
    if (!refundableStatuses.includes(order.status)) {
      logger.info("webhook.charge_refunded.already_resolved", {
        eventId: event.id,
        orderId: order.id,
        status: order.status,
      });
      return; // Idempotent — already in terminal or irrelevant state
    }

    await orderRepository.$transaction(async (tx) => {
      await transitionOrder(
        order.id,
        "REFUNDED",
        { updatedAt: new Date() },
        { tx, fromStatus: order.status },
      );

      await orderEventService.recordEvent({
        orderId: order.id,
        type: ORDER_EVENT_TYPES.CHARGE_REFUNDED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: "Refund issued by Stripe — order refunded",
        metadata: {
          stripePaymentIntentId: piId,
          trigger: "charge.refunded",
          amountRefunded: charge.amount_refunded,
        },
        tx,
      });
    });

    logger.info("webhook.charge_refunded.order_refunded", {
      orderId: order.id,
      paymentIntentId: piId,
      eventId: event.id,
    });
  }

  /**
   * charge.dispute.created — buyer filed a chargeback with their bank.
   * Creates a Dispute record (source=CHARGEBACK) and transitions order to DISPUTED.
   */
  private async handleChargeDisputeCreated(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;
    const piId = dispute.payment_intent as string | null;
    if (!piId) return;

    const order = await orderRepository.findByStripePaymentIntentId(piId);
    if (!order) {
      logger.warn("webhook.charge_dispute.created.order_not_found", {
        eventId: event.id,
        paymentIntentId: piId,
        stripeDisputeId: dispute.id,
      });
      return;
    }

    // Check if a dispute record already exists — idempotent on second delivery.
    const existingDispute = await disputeRepository.findByOrderId(order.id);

    await orderRepository.$transaction(async (tx) => {
      if (!existingDispute) {
        await disputeRepository.create(
          {
            orderId: order.id,
            reason: dispute.reason ?? "OTHER",
            source: "CHARGEBACK",
            status: "OPEN",
            buyerStatement: null,
            openedAt: new Date(),
          },
          tx,
        );
      }

      // Only transition to DISPUTED if not already in DISPUTED or a terminal state.
      const disputeableStatuses = ["PAYMENT_HELD", "DISPATCHED", "DELIVERED"];
      if (disputeableStatuses.includes(order.status)) {
        await transitionOrder(
          order.id,
          "DISPUTED",
          { updatedAt: new Date() },
          { tx, fromStatus: order.status },
        );
      }

      await orderEventService.recordEvent({
        orderId: order.id,
        type: ORDER_EVENT_TYPES.CHARGEBACK_OPENED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: "Chargeback filed by buyer with their bank",
        metadata: {
          stripeDisputeId: dispute.id,
          reason: dispute.reason,
          amount: dispute.amount,
        },
        tx,
      });
    });

    // Notify seller out of band — non-fatal if this fails.
    fireAndForget(
      createNotification({
        userId: order.sellerId,
        type: "CHARGEBACK_OPENED",
        title: "Chargeback filed",
        body: "A buyer has filed a chargeback with their bank. Please check your dashboard.",
        orderId: order.id,
      }),
      "webhook.charge_dispute.created.notification",
    );

    logger.info("webhook.charge_dispute.created", {
      orderId: order.id,
      stripeDisputeId: dispute.id,
      eventId: event.id,
    });
  }

  /**
   * charge.dispute.closed — bank resolved the chargeback.
   * won = seller keeps the money → COMPLETED.
   * lost = buyer gets money back → REFUNDED.
   */
  private async handleChargeDisputeClosed(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;
    const piId = dispute.payment_intent as string | null;
    if (!piId) return;

    const order = await orderRepository.findByStripePaymentIntentId(piId);
    if (!order) {
      logger.warn("webhook.charge_dispute.closed.order_not_found", {
        eventId: event.id,
        paymentIntentId: piId,
        stripeDisputeId: dispute.id,
      });
      return;
    }

    // Only act if order is still DISPUTED — terminal states are no-ops.
    if (order.status !== "DISPUTED") {
      logger.info("webhook.charge_dispute.closed.already_resolved", {
        eventId: event.id,
        orderId: order.id,
        status: order.status,
      });
      return; // Idempotent
    }

    const won = dispute.status === "won";
    const targetStatus = won ? "COMPLETED" : "REFUNDED";

    // Map to our DisputeStatus: seller wins → RESOLVED_SELLER, buyer wins → RESOLVED_BUYER
    const resolvedDisputeStatus = won ? "RESOLVED_SELLER" : "RESOLVED_BUYER";

    const existingDispute = await disputeRepository.findByOrderId(order.id);

    await orderRepository.$transaction(async (tx) => {
      await transitionOrder(
        order.id,
        targetStatus,
        won ? { completedAt: new Date() } : { updatedAt: new Date() },
        { tx, fromStatus: order.status },
      );

      if (existingDispute) {
        await disputeRepository.update(
          existingDispute.id,
          {
            status: resolvedDisputeStatus as
              | "RESOLVED_SELLER"
              | "RESOLVED_BUYER",
          },
          tx,
        );
      }

      await orderEventService.recordEvent({
        orderId: order.id,
        type: ORDER_EVENT_TYPES.CHARGEBACK_RESOLVED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: won
          ? "Chargeback resolved in seller's favour — order completed"
          : "Chargeback resolved in buyer's favour — order refunded",
        metadata: {
          stripeDisputeId: dispute.id,
          disputeStatus: dispute.status,
          won,
        },
        tx,
      });
    });

    logger.info("webhook.charge_dispute.closed", {
      orderId: order.id,
      stripeDisputeId: dispute.id,
      outcome: dispute.status,
      targetStatus,
      eventId: event.id,
    });
  }

  /**
   * payout.failed — Stripe payout to seller's bank failed.
   * Fires on the connected account level (event.account = stripeAccountId).
   * Marks the seller's latest PROCESSING payout as FAILED and notifies them.
   */
  private async handlePayoutFailed(event: Stripe.Event): Promise<void> {
    const payout = event.data.object as Stripe.Payout;
    // Connect webhooks carry the connected account ID on the event object.
    const stripeAccountId = (event as Stripe.Event & { account?: string })
      .account;

    logger.error("webhook.payout.failed", {
      stripePayoutId: payout.id,
      stripeAccountId,
      amount: payout.amount,
      currency: payout.currency,
      failureCode: payout.failure_code,
      failureMessage: payout.failure_message,
      requiresManualReconciliation: true,
      eventId: event.id,
    });

    if (!stripeAccountId) return;

    // Find the seller's latest PROCESSING payout and mark it FAILED.
    const sellerPayout =
      await payoutRepository.findLatestProcessingByStripeAccount(
        stripeAccountId,
      );
    if (!sellerPayout) return;

    await payoutRepository.markFailed(
      sellerPayout.id,
      payout.failure_message ??
        payout.failure_code ??
        "Stripe bank payout failed",
    );

    // Notify seller out of band.
    fireAndForget(
      createNotification({
        userId: sellerPayout.userId,
        type: "PAYOUT_FAILED",
        title: "Payout to bank account failed",
        body: "Your payout could not be transferred to your bank. Our team will be in touch.",
        orderId: sellerPayout.orderId,
      }),
      "webhook.payout.failed.notification",
    );
  }

  /**
   * transfer.failed — Stripe transfer to connected account failed.
   * Finds our Payout record by stripeTransferId and marks it FAILED.
   */
  private async handleTransferFailed(event: Stripe.Event): Promise<void> {
    const transfer = event.data.object as Stripe.Transfer;

    const payout = await payoutRepository.findByStripeTransferId(transfer.id);
    if (!payout) {
      logger.error("webhook.transfer.failed.payout_not_found", {
        stripeTransferId: transfer.id,
        requiresManualReconciliation: true,
        eventId: event.id,
      });
      return;
    }

    // Idempotent — if already failed, skip the update.
    if (payout.status === "FAILED") {
      logger.info("webhook.transfer.failed.already_failed", {
        payoutId: payout.id,
        eventId: event.id,
      });
      return;
    }

    await payoutRepository.markFailed(
      payout.id,
      `Stripe transfer failed — eventId: ${event.id}`,
    );

    logger.error("webhook.transfer.failed", {
      payoutId: payout.id,
      orderId: payout.orderId,
      stripeTransferId: transfer.id,
      requiresManualReconciliation: true,
      eventId: event.id,
    });

    // Notify seller out of band.
    fireAndForget(
      createNotification({
        userId: payout.userId,
        type: "PAYOUT_FAILED",
        title: "Payout failed",
        body: "Your payout could not be processed. Our team will be in touch.",
        orderId: payout.orderId,
      }),
      "webhook.transfer.failed.notification",
    );
  }

  /**
   * transfer.reversed — a transfer to a connected account was reversed.
   * Marks our Payout record as REVERSED and logs for manual reconciliation.
   */
  private async handleTransferReversed(event: Stripe.Event): Promise<void> {
    const transfer = event.data.object as Stripe.Transfer;

    const payout = await payoutRepository.findByStripeTransferId(transfer.id);
    if (!payout) {
      logger.error("webhook.transfer.reversed.payout_not_found", {
        stripeTransferId: transfer.id,
        requiresManualReconciliation: true,
        eventId: event.id,
      });
      return;
    }

    // Idempotent — already reversed.
    if (payout.status === "REVERSED") {
      logger.info("webhook.transfer.reversed.already_reversed", {
        payoutId: payout.id,
        eventId: event.id,
      });
      return;
    }

    await payoutRepository.markReversed(payout.id);

    logger.error("webhook.transfer.reversed", {
      payoutId: payout.id,
      orderId: payout.orderId,
      stripeTransferId: transfer.id,
      requiresManualReconciliation: true,
      eventId: event.id,
    });
  }

  /**
   * payment_intent.canceled — PaymentIntent was cancelled (expired or manual).
   * Transitions the order to CANCELLED and releases the listing reservation.
   */
  private async handlePaymentIntentCanceled(
    event: Stripe.Event,
  ): Promise<void> {
    const pi = event.data.object as Stripe.PaymentIntent;
    const orderId = pi.metadata?.orderId;
    if (!orderId) return;

    const currentOrder = await orderRepository.findForWebhookStatus(orderId);
    if (!currentOrder) return;

    // Only cancel from AWAITING_PAYMENT — all other states are no-ops.
    if (currentOrder.status !== "AWAITING_PAYMENT") {
      logger.info("webhook.payment_intent.canceled.already_resolved", {
        orderId,
        currentStatus: currentOrder.status,
        eventId: event.id,
      });
      return; // Idempotent
    }

    await orderRepository.$transaction(async (tx) => {
      await transitionOrder(
        orderId,
        "CANCELLED",
        { cancelledAt: new Date(), cancelReason: "PaymentIntent cancelled" },
        { tx, fromStatus: currentOrder.status },
      );

      await orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.PAYMENT_INTENT_CANCELLED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: "Payment intent cancelled — order cancelled",
        metadata: {
          stripePaymentIntentId: pi.id,
          cancellationReason: pi.cancellation_reason,
        },
        tx,
      });
    });

    // Release listing reservation so other buyers can purchase it.
    const listingId = pi.metadata?.listingId;
    if (listingId) {
      await listingRepository.releaseReservation(listingId);
    }

    logger.info("webhook.payment_intent.canceled", {
      orderId,
      stripePaymentIntentId: pi.id,
      eventId: event.id,
    });
  }
}

export const webhookService = new WebhookService();
