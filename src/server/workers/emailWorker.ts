// src/server/workers/emailWorker.ts  (Sprint 4)
// ─── Email Worker ────────────────────────────────────────────────────────────
// Processes emailQueue jobs with 3 retries and exponential backoff.
// Job types: welcome, passwordReset, offerReceived, offerResponse,
//            orderDispatched, orderComplete
// All jobs are idempotent — Postmark deduplicates by MessageID.

import { Worker } from 'bullmq';
import { getRedisConnection } from '@/lib/queue';
import type { EmailJobData } from '@/lib/queue';
import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendOfferReceivedEmail,
  sendOfferResponseEmail,
  sendOrderDispatchedEmail,
} from '@/server/email';
import { audit } from '@/server/lib/audit';

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
          console.log('[EmailWorker] orderComplete email — not yet implemented', payload);
          break;

        default:
          console.warn(`[EmailWorker] Unknown email type: ${type}`);
      }

      // Audit successful send
      audit({
        action: 'ADMIN_ACTION',
        metadata: { worker: 'email', jobType: type, jobId: job.id, status: 'sent' },
      });
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
      limiter: { max: 10, duration: 1000 }, // Max 10 emails/sec (Postmark limit)
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[EmailWorker] Job ${job?.id} failed:`, err.message);
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
    console.log(`[EmailWorker] Job ${job.id} completed (${job.data.type})`);
  });

  return worker;
}
