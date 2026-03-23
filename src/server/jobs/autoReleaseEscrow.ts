// src/server/jobs/autoReleaseEscrow.ts
// ─── Auto-Release Escrow Job ──────────────────────────────────────────────────
// Captures Stripe payment and marks order COMPLETED for dispatched orders
// that have not been confirmed by the buyer after 4 calendar days.
// Called hourly by Vercel Cron via /api/cron/auto-release.

import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import Stripe from 'stripe';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' as any });

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

export async function processAutoReleases(): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  // 4 calendar days cutoff
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 4);

  const eligibleOrders = await db.order.findMany({
    where: {
      status: 'DISPATCHED',
      dispatchedAt: { lte: cutoffDate },
    },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      totalNzd: true,
      stripePaymentIntentId: true,
      listing: { select: { title: true, id: true } },
      buyer: { select: { email: true, displayName: true } },
      seller: { select: { email: true, displayName: true } },
    },
  });

  console.log(`[AUTO-RELEASE] Found ${eligibleOrders.length} eligible orders`);

  for (const order of eligibleOrders) {
    try {
      // Capture payment (release escrow to seller)
      if (order.stripePaymentIntentId) {
        try {
          await stripe.paymentIntents.capture(order.stripePaymentIntentId);
        } catch (stripeErr: unknown) {
          const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr);
          // Skip if already captured or nothing to capture
          if (!msg.includes('already captured') && !msg.includes('amount_capturable')) {
            throw stripeErr;
          }
          console.log(`[AUTO-RELEASE] Stripe already settled for order ${order.id} — continuing`);
        }
      }

      // Update order + payout in a single transaction
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

      console.log(`[AUTO-RELEASE] ✓ Order ${order.id} released → ${order.seller.displayName}`);
      processed++;
    } catch (err) {
      console.error(`[AUTO-RELEASE] ✗ Failed for order ${order.id}:`, err);
      errors++;
    }
  }

  console.log(`[AUTO-RELEASE] Done: ${processed} released, ${errors} errors`);
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
