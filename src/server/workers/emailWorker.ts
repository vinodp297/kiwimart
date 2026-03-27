// src/server/workers/emailWorker.ts  (Sprint 4)
// ─── Email Worker ────────────────────────────────────────────────────────────
// Processes emailQueue jobs with 3 retries and exponential backoff.
// Job types: welcome, passwordReset, offerReceived, offerResponse,
//            orderDispatched, orderComplete
// All jobs are idempotent — Resend deduplicates by MessageID.

import { Worker } from 'bullmq';
import { getRedisConnection } from '@/lib/queue';
import type { EmailJobData } from '@/lib/queue';
import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendOfferReceivedEmail,
  sendOfferResponseEmail,
  sendOrderDispatchedEmail,
  sendDisputeOpenedEmail,
} from '@/server/email';
import { audit } from '@/server/lib/audit';
import { logger } from '@/shared/logger';

export function startEmailWorker() {
  const worker = new Worker<EmailJobData>(
    'email',
    async (job) => {
      const { type, payload } = job.data;

      switch (type) {
        case 'welcome':
          await sendWelcomeEmail(payload as Parameters<typeof sendWelcomeEmail>[0]);
          break;

        case 'passwordReset':
          await sendPasswordResetEmail(payload as Parameters<typeof sendPasswordResetEmail>[0]);
          break;

        case 'offerReceived':
          await sendOfferReceivedEmail(payload as Parameters<typeof sendOfferReceivedEmail>[0]);
          break;

        case 'offerResponse':
          await sendOfferResponseEmail(payload as Parameters<typeof sendOfferResponseEmail>[0]);
          break;

        case 'orderDispatched':
          await sendOrderDispatchedEmail(payload as Parameters<typeof sendOrderDispatchedEmail>[0]);
          break;

        case 'orderComplete':
          // Sprint 5: sendOrderCompleteEmail
          logger.info('email.worker.order_complete_stub', { payload });
          break;

        case 'disputeOpened':
          await sendDisputeOpenedEmail(payload as Parameters<typeof sendDisputeOpenedEmail>[0]);
          break;

        default:
          logger.warn('email.worker.unknown_type', { type });
      }

      // Audit successful send
      audit({
        action: 'ADMIN_ACTION',
        metadata: { worker: 'email', jobType: type, jobId: job.id, status: 'sent' },
      });
    },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: getRedisConnection() as any,
      concurrency: 5,
      limiter: { max: 10, duration: 1000 }, // Max 10 emails/sec (Resend limit)
    }
  );

  worker.on('failed', (job, err) => {
    logger.error('email.worker.job_failed', {
      jobId: job?.id,
      jobType: job?.data?.type,
      error: err.message,
    });
    audit({
      action: 'ADMIN_ACTION',
      metadata: {
        worker: 'email',
        jobId: job?.id,
        jobType: job?.data?.type,
        error: err.message,
        status: 'failed',
      },
    });
  });

  worker.on('completed', (job) => {
    logger.info('email.worker.job_completed', { jobId: job.id, type: job.data.type });
  });

  return worker;
}
