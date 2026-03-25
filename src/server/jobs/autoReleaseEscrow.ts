// src/server/jobs/autoReleaseEscrow.ts
// ─── Auto-Release Escrow Job ──────────────────────────────────────────────────
// Captures Stripe payment and marks order COMPLETED for dispatched orders
// that have not been confirmed by the buyer after 4 BUSINESS days.
// Called daily at 2:00 AM UTC by Vercel Cron via /api/cron/auto-release
// (schedule: "0 2 * * *" in vercel.json).

import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import { stripe } from '@/infrastructure/stripe/client';
import { logger } from '@/shared/logger';

/**
 * Add N business days (Mon–Fri) to a date.
 * E.g. Friday + 4 business days = Thursday of the following week.
 */
export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

export async function processAutoReleases(): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  // Fetch ALL dispatched orders, then filter by business-day cutoff in JS
  const dispatchedOrders = await db.order.findMany({
    where: {
      status: 'DISPATCHED',
      dispatchedAt: { not: null },
    },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      totalNzd: true,
      stripePaymentIntentId: true,
      dispatchedAt: true,
      listing: { select: { title: true, id: true } },
      buyer: { select: { email: true, displayName: true } },
      seller: { select: { email: true, displayName: true } },
    },
  });

  const now = new Date();
  const eligibleOrders = dispatchedOrders.filter((order) => {
    if (!order.dispatchedAt) return false;
    const releaseDate = addBusinessDays(order.dispatchedAt, 4);
    return releaseDate <= now;
  });

  logger.info('escrow.auto_release.started', {
    eligible: eligibleOrders.length,
    dispatched: dispatchedOrders.length,
  });

  for (const order of eligibleOrders) {
    try {
      // STEP B — Hard fail on missing payment intent
      if (!order.stripePaymentIntentId) {
        logger.error('escrow.auto_release.skipped', {
          orderId: order.id,
          reason: 'missing_payment_intent',
          requiresManualReview: true,
        });
        audit({
          userId: null,
          action: 'ORDER_STATUS_CHANGED',
          entityType: 'Order',
          entityId: order.id,
          metadata: {
            trigger: 'AUTO_RELEASE_SKIPPED',
            reason: 'missing_payment_intent',
            requiresManualReview: true,
          },
        });
        errors++;
        continue;
      }

      // STEP C — Stripe capture FIRST, then DB update
      try {
        await stripe.paymentIntents.capture(order.stripePaymentIntentId);
      } catch (stripeErr: unknown) {
        const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr);
        // Skip if already captured — still safe to mark COMPLETED
        if (!msg.includes('already captured') && !msg.includes('amount_capturable')) {
          // Stripe capture failed — leave order as DISPATCHED
          logger.error('escrow.auto_release.capture_failed', {
            orderId: order.id,
            error: msg,
            requiresManualReview: true,
          });
          audit({
            userId: null,
            action: 'ORDER_STATUS_CHANGED',
            entityType: 'Order',
            entityId: order.id,
            metadata: {
              trigger: 'AUTO_RELEASE_CAPTURE_FAILED',
              error: msg,
              requiresManualReview: true,
            },
          });
          errors++;
          continue;
        }
        logger.info('escrow.auto_release.already_captured', { orderId: order.id });
      }

      // DB update ONLY AFTER Stripe capture succeeds
      await db.$transaction([
        db.order.update({
          where: { id: order.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        }),
        db.payout.updateMany({
          where: { orderId: order.id },
          data: { status: 'PROCESSING', initiatedAt: new Date() },
        }),
        db.listing.update({
          where: { id: order.listing.id },
          data: { status: 'SOLD', soldAt: new Date() },
        }),
      ]);

      audit({
        userId: null,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'Order',
        entityId: order.id,
        metadata: {
          newStatus: 'COMPLETED',
          previousStatus: 'DISPATCHED',
          trigger: 'AUTO_RELEASE',
          buyerEmail: order.buyer.email,
          sellerEmail: order.seller.email,
        },
      });

      logger.info('escrow.auto_release.order_released', {
        orderId: order.id,
        sellerName: order.seller.displayName,
      });
      processed++;
    } catch (err) {
      logger.error('escrow.auto_release.failed', {
        orderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
    }
  }

  logger.info('escrow.auto_release.completed', { processed, errors });
  return { processed, errors };
}

export function getAutoReleaseCountdown(dispatchedAt: Date): {
  daysRemaining: number;
  releaseDate: Date;
} {
  const releaseDate = addBusinessDays(dispatchedAt, 4);
  const now = new Date();
  const msRemaining = releaseDate.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  return { daysRemaining, releaseDate };
}
