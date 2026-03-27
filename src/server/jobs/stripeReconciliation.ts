// src/server/jobs/stripeReconciliation.ts
// ─── Stripe / DB Reconciliation Job ──────────────────────────────────────────
// Detects discrepancies between Stripe PaymentIntent states and DB order
// statuses. Run daily via /api/cron/stripe-reconciliation.
//
// All discrepancies are LOGGED ONLY — no auto-fixing.
// Operations team reviews the logs and resolves manually to avoid
// unintended side effects from automated state corrections.
//
// Check 1: Stripe PIs in requires_capture → DB order still AWAITING_PAYMENT
//   Cause: webhook missed or processed out of order.
//   Action needed: manually transition order to PAYMENT_HELD.
//
// Check 2: DB orders in PAYMENT_HELD → Stripe PI cancelled or failed
//   Cause: PI expired, refunded outside system, or manual Stripe action.
//   Action needed: manually cancel order and reconcile funds.

import db from '@/lib/db'
import { stripe } from '@/infrastructure/stripe/client'
import { logger } from '@/shared/logger'

export async function runStripeReconciliation(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000) // last 24 hours

  logger.info('stripe.reconciliation.started', { since: since.toISOString() })

  // ── Check 1: PIs in requires_capture with AWAITING_PAYMENT orders ──────────
  // Stripe has authorised the payment, but our webhook hasn't updated the DB.
  // This means the buyer was charged but the order is stuck.
  try {
    const piList = await stripe.paymentIntents.list({
      limit: 100,
      created: { gte: Math.floor(since.getTime() / 1000) },
    })

    for (const pi of piList.data) {
      if (pi.status !== 'requires_capture') continue
      const orderId = pi.metadata?.orderId
      if (!orderId) continue

      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true },
      })

      if (order && order.status === 'AWAITING_PAYMENT') {
        logger.error('stripe.reconciliation.awaiting_but_pi_ready', {
          orderId,
          stripePaymentIntentId: pi.id,
          dbStatus: order.status,
          piStatus: pi.status,
          requiresManualReview: true,
          message:
            'Order is AWAITING_PAYMENT but Stripe PI is requires_capture. ' +
            'Likely a missed webhook — manually transition order to PAYMENT_HELD.',
        })
      }
    }
  } catch (err) {
    logger.error('stripe.reconciliation.check1_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // ── Check 2: PAYMENT_HELD orders with cancelled/failed Stripe PI ──────────
  // DB says the order is paid but Stripe says the PI is no longer active.
  // Funds may have been refunded externally or the PI may have expired.
  try {
    const heldOrders = await db.order.findMany({
      where: {
        status: 'PAYMENT_HELD',
        stripePaymentIntentId: { not: null },
        createdAt: { gte: since },
      },
      select: { id: true, stripePaymentIntentId: true },
      take: 100,
    })

    for (const order of heldOrders) {
      if (!order.stripePaymentIntentId) continue

      try {
        const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId)

        // 'canceled' = PI explicitly cancelled (e.g. external refund or expiry)
        // 'requires_payment_method' = payment failed, PI awaiting retry
        if (pi.status === 'canceled' || pi.status === 'requires_payment_method') {
          logger.error('stripe.reconciliation.held_but_pi_failed', {
            orderId: order.id,
            stripePaymentIntentId: order.stripePaymentIntentId,
            dbStatus: 'PAYMENT_HELD',
            piStatus: pi.status,
            requiresManualReview: true,
            message:
              `Order is PAYMENT_HELD but Stripe PI status is ${pi.status}. ` +
              'Funds may have been externally refunded or PI expired — manual review required.',
          })
        }
      } catch (err) {
        logger.warn('stripe.reconciliation.pi_retrieve_failed', {
          orderId: order.id,
          stripePaymentIntentId: order.stripePaymentIntentId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } catch (err) {
    logger.error('stripe.reconciliation.check2_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  logger.info('stripe.reconciliation.completed')
}
