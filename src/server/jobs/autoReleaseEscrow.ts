// src/server/jobs/autoReleaseEscrow.ts
// ─── Auto-Release Escrow Job ──────────────────────────────────────────────────
// Captures Stripe payment and marks order COMPLETED for dispatched orders
// that have not been confirmed by the buyer after 4 BUSINESS days.
// Called daily at 2:00 AM UTC by Vercel Cron via /api/cron/auto-release
// (schedule: "0 2 * * *" in vercel.json).

import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import { paymentService } from '@/modules/payments/payment.service';
import { transitionOrder } from '@/modules/orders/order.transitions';
import { acquireLock, releaseLock } from '@/server/lib/distributedLock';
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

  // DB-side pre-filter: only orders dispatched within the last 30 days.
  // This caps the result set so the query never loads unbounded rows into memory.
  // The JS addBusinessDays() filter below fine-tunes the exact 4-business-day cutoff.
  // Safety cap: take: 500 ensures a single cron run never exceeds memory limits
  // even if the pre-filter is wider than expected.
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  const dispatchedOrders = await db.order.findMany({
    where: {
      status: 'DISPATCHED',
      dispatchedAt: {
        not: null,
        gte: cutoffDate, // Only orders dispatched in the last 30 days
      },
    },
    take: 500,           // Safety cap — prevents unbounded memory use
    orderBy: { dispatchedAt: 'asc' }, // Process oldest first
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

  // Process in parallel batches of 10 to avoid sequential Stripe calls
  const BATCH_SIZE = 10;

  async function processOrderRelease(order: typeof eligibleOrders[number]) {
    // Hard fail on missing payment intent
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
      return false;
    }

    // Distributed lock — prevents two cron runs from double-releasing the same order
    const lockValue = await acquireLock(`order:release:${order.id}`, 60);
    if (lockValue === null) {
      // Lock held by concurrent process — already being processed
      logger.info('escrow.auto_release.lock_skipped', { orderId: order.id });
      return true; // Treat as already processed
    }

    try {
      // Stripe capture FIRST via PaymentService, then DB update
      try {
        await paymentService.capturePayment({
          paymentIntentId: order.stripePaymentIntentId,
          orderId: order.id,
        });
      } catch (captureErr) {
        logger.error('escrow.auto_release.capture_failed', {
          orderId: order.id,
          error: captureErr instanceof Error ? captureErr.message : String(captureErr),
          requiresManualReview: true,
        });
        audit({
          userId: null,
          action: 'ORDER_STATUS_CHANGED',
          entityType: 'Order',
          entityId: order.id,
          metadata: {
            trigger: 'AUTO_RELEASE_CAPTURE_FAILED',
            error: captureErr instanceof Error ? captureErr.message : String(captureErr),
            requiresManualReview: true,
          },
        });
        return false;
      }

      // DB update ONLY AFTER Stripe capture succeeds — callback form for transitionOrder
      await db.$transaction(async (tx) => {
        await transitionOrder(order.id, 'COMPLETED', { completedAt: new Date() }, { tx, fromStatus: 'DISPATCHED' });
        await tx.payout.updateMany({
          where: { orderId: order.id },
          data: { status: 'PROCESSING', initiatedAt: new Date() },
        });
        await tx.listing.update({
          where: { id: order.listing.id },
          data: { status: 'SOLD', soldAt: new Date() },
        });
      });
    } catch (err) {
      // P2025 = optimistic lock conflict — another process already transitioned this order
      if ((err as { code?: string }).code === 'P2025') {
        logger.info('escrow.auto_release.already_processed', { orderId: order.id });
        return true;
      }
      throw err;
    } finally {
      await releaseLock(`order:release:${order.id}`, lockValue);
    }

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
    return true;
  }

  for (let i = 0; i < eligibleOrders.length; i += BATCH_SIZE) {
    const batch = eligibleOrders.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (order) => {
        try {
          return await processOrderRelease(order);
        } catch (err) {
          logger.error('escrow.auto_release.failed', {
            orderId: order.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return false;
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        processed++;
      } else {
        errors++;
      }
    }

    // Small delay between batches to respect Stripe rate limits
    if (i + BATCH_SIZE < eligibleOrders.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
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
