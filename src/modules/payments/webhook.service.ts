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

import type { Stripe } from '@/infrastructure/stripe/client'
import { logger } from '@/shared/logger'
import { audit } from '@/server/lib/audit'
import db from '@/lib/db'
import { transitionOrder } from '@/modules/orders/order.transitions'

export class WebhookService {
  /**
   * Race-safe idempotency: try to insert, catch unique constraint violation.
   * Returns true if this is a new event, false if already processed.
   */
  async markEventProcessed(eventId: string, type: string): Promise<boolean> {
    try {
      await db.stripeEvent.create({
        data: { id: eventId, type },
      })
      return true
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        logger.info('stripe.webhook.duplicate', { eventId, type })
        return false
      }
      throw err
    }
  }

  async processEvent(event: Stripe.Event): Promise<void> {
    // Duplicate check FIRST — skip if already successfully processed
    const isNew = await this.markEventProcessed(event.id, event.type)
    if (!isNew) return

    // Handler runs AFTER duplicate check. If the handler throws, the event
    // row is already inserted, so we delete it in the catch to allow Stripe
    // retries. Handlers are idempotent (optimistic locking) so re-delivery
    // is safe.
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event)
          break

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event)
          break

        case 'account.updated':
          await this.handleAccountUpdated(event)
          break

        case 'transfer.created':
          await this.handleTransferCreated(event)
          break

        default:
          break
      }
    } catch (handlerError) {
      // Handler failed — DELETE the event record so Stripe retry is not
      // blocked by the idempotency check. The handler is idempotent so
      // re-processing on retry is safe.
      try {
        await db.stripeEvent.delete({ where: { id: event.id } })
      } catch {
        // If delete also fails, the event is stuck as "processed".
        // The daily reconciliation cron will detect the mismatch.
        logger.error('webhook.event.rollback_failed', {
          eventId: event.id,
          type: event.type,
        })
      }
      throw handlerError
    }
  }

  private async handlePaymentIntentSucceeded(event: Stripe.Event): Promise<void> {
    const pi = event.data.object as Stripe.PaymentIntent
    const orderId = pi.metadata?.orderId
    const sellerId = pi.metadata?.sellerId
    if (!orderId || !sellerId) return

    // State validation: only transition from AWAITING_PAYMENT to PAYMENT_HELD.
    // Prevents replayed webhooks from reverting completed/refunded orders.
    const currentOrder = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    })

    if (currentOrder?.status !== 'AWAITING_PAYMENT') {
      logger.warn('webhook.payment_intent_succeeded: unexpected order state', {
        orderId,
        currentStatus: currentOrder?.status ?? 'NOT_FOUND',
        eventId: event.id,
        stripePaymentIntentId: pi.id,
      })
      return // Return without error — Stripe should not retry this
    }

    await db.$transaction(async (tx) => {
      await transitionOrder(orderId, 'PAYMENT_HELD', { updatedAt: new Date() }, { tx, fromStatus: currentOrder.status })
      await tx.payout.upsert({
        where: { orderId },
        create: {
          orderId,
          userId: sellerId,
          amountNzd: Math.round(
            (pi.amount - (pi.application_fee_amount ?? 0)) * 1
          ),
          platformFeeNzd: pi.application_fee_amount ?? 0,
          stripeFeeNzd: 0,
          status: 'PENDING',
        },
        update: {},
      })
    })

    audit({
      action: 'PAYMENT_COMPLETED',
      entityType: 'Order',
      entityId: orderId,
      metadata: { stripePaymentIntentId: pi.id, amountNzd: pi.amount },
    })
  }

  private async handlePaymentIntentFailed(event: Stripe.Event): Promise<void> {
    const pi = event.data.object as Stripe.PaymentIntent
    const orderId = pi.metadata?.orderId
    if (!orderId) return

    // Fetch current status — only cancel AWAITING_PAYMENT orders.
    // Guards against replayed webhooks reverting orders already past payment.
    const currentOrder = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    })

    if (!currentOrder || currentOrder.status !== 'AWAITING_PAYMENT') {
      logger.warn('webhook.payment_intent_failed: unexpected order state', {
        orderId,
        currentStatus: currentOrder?.status ?? 'NOT_FOUND',
        eventId: event.id,
      })
      return
    }

    await transitionOrder(orderId, 'CANCELLED', {}, { fromStatus: currentOrder.status })

    // Release listing reservation so other buyers can purchase it.
    // Guard: only release if still RESERVED — never overwrite SOLD/ACTIVE.
    const listingId = pi.metadata?.listingId
    if (listingId) {
      await db.listing.updateMany({
        where: { id: listingId, status: 'RESERVED' },
        data: { status: 'ACTIVE' },
      })
    }

    audit({
      action: 'PAYMENT_FAILED',
      entityType: 'Order',
      entityId: orderId,
      metadata: {
        stripePaymentIntentId: pi.id,
        failureCode: pi.last_payment_error?.code,
      },
    })
  }

  private async handleAccountUpdated(event: Stripe.Event): Promise<void> {
    const account = event.data.object as Stripe.Account
    const onboarded =
      account.details_submitted === true &&
      account.charges_enabled === true &&
      account.payouts_enabled === true

    await db.user.updateMany({
      where: { stripeAccountId: account.id },
      data: {
        stripeOnboarded: onboarded,
        stripeChargesEnabled: account.charges_enabled ?? false,
        stripePayoutsEnabled: account.payouts_enabled ?? false,
      },
    })
  }

  private async handleTransferCreated(event: Stripe.Event): Promise<void> {
    const transfer = event.data.object as Stripe.Transfer
    await db.payout.updateMany({
      where: { stripeTransferId: transfer.id },
      data: { status: 'PROCESSING' },
    })
  }
}

export const webhookService = new WebhookService()
