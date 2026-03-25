// src/server/workers/payoutWorker.ts  (Sprint 4)
// ─── Payout Processing Worker ────────────────────────────────────────────────
// Processes payoutQueue jobs:
//   After order.completedAt + 3 business days:
//     1. Initiate Stripe transfer to seller's Connect account
//     2. Update payout status to PROCESSING
//     3. Send seller notification email
//
// All jobs are idempotent — checks payout status before processing.

import { Worker } from 'bullmq';
import { getRedisConnection } from '@/lib/queue';
import { emailQueue } from '@/lib/queue';
import type { PayoutJobData } from '@/lib/queue';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import { stripe } from '@/infrastructure/stripe/client';
import { logger } from '@/shared/logger';

export function startPayoutWorker() {
  const worker = new Worker<PayoutJobData>(
    'payout',
    async (job) => {
      const { orderId, sellerId, amountNzd, stripeAccountId } = job.data;

      // Idempotency check — skip if already processing or paid
      const payout = await db.payout.findUnique({
        where: { orderId },
        select: { id: true, status: true },
      });

      if (!payout) {
        throw new Error(`Payout not found for order ${orderId}`);
      }

      if (payout.status !== 'PENDING') {
        logger.info('payout.worker.skipped', { payoutId: payout.id, status: payout.status });
        return { skipped: true, reason: `Already ${payout.status}` };
      }

      // 1. Initiate Stripe transfer to seller's Connect account
      const transfer = await stripe.transfers.create({
        amount: amountNzd,
        currency: 'nzd',
        destination: stripeAccountId,
        metadata: {
          orderId,
          payoutId: payout.id,
          sellerId,
        },
        description: `KiwiMart payout for order ${orderId}`,
      });

      // 2. Update payout status
      await db.payout.update({
        where: { orderId },
        data: {
          status: 'PROCESSING',
          stripeTransferId: transfer.id,
          initiatedAt: new Date(),
        },
      });

      // 3. Notify seller via email queue
      const seller = await db.user.findUnique({
        where: { id: sellerId },
        select: { email: true, displayName: true },
      });

      if (seller) {
        await emailQueue.add(
          'payout-notification',
          {
            type: 'orderComplete' as const,
            payload: {
              to: seller.email,
              sellerName: seller.displayName,
              orderId,
              amount: amountNzd / 100,
            },
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
        );
      }

      // 4. Audit
      audit({
        userId: sellerId,
        action: 'PAYOUT_INITIATED',
        entityType: 'Payout',
        entityId: payout.id,
        metadata: {
          orderId,
          amountNzd,
          stripeTransferId: transfer.id,
        },
      });

      return { transferId: transfer.id };
    },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: getRedisConnection() as any,
      concurrency: 2,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error('payout.worker.job_failed', {
      jobId: job?.id,
      orderId: job?.data?.orderId,
      error: err.message,
    });
    audit({
      action: 'ADMIN_ACTION',
      metadata: {
        worker: 'payout',
        jobId: job?.id,
        orderId: job?.data?.orderId,
        error: err.message,
        status: 'failed',
      },
    });
  });

  worker.on('completed', (job) => {
    logger.info('payout.worker.job_completed', { jobId: job.id, orderId: job.data.orderId });
  });

  return worker;
}
