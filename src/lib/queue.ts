// src/lib/queue.ts  (Sprint 4)
// ─── BullMQ Job Queues ───────────────────────────────────────────────────────
// Connects to Upstash Redis via ioredis for background job processing.
// Queues:
//   • emailQueue     — non-blocking email sending (retry 3×, exponential backoff)
//   • imageQueue     — scan + resize pipeline (download → scan → resize → re-upload)
//   • payoutQueue    — payout processing (3 business days after delivery)
//   • notificationQueue — push notifications (Sprint 5)
//
// All jobs are idempotent — safe to run twice without side effects.

import { Queue } from 'bullmq';
import { getQueueConnection } from '@/infrastructure/queue/client';

export { getQueueConnection as getRedisConnection };

// ── Queue instances ──────────────────────────────────────────────────────────

const defaultOpts = {
  // BullMQ bundles its own ioredis types which conflict with the project's ioredis.
  // The runtime connection works correctly — this cast bridges the type mismatch.
  connection: getQueueConnection() as unknown as import('bullmq').ConnectionOptions,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
  },
};

export const emailQueue = new Queue('email', defaultOpts);
export const imageQueue = new Queue('image', defaultOpts);
export const payoutQueue = new Queue('payout', defaultOpts);
export const notificationQueue = new Queue('notification', defaultOpts);

// ── Job type definitions ─────────────────────────────────────────────────────

export interface EmailJobData {
  type: 'welcome' | 'passwordReset' | 'offerReceived' | 'offerResponse' | 'orderDispatched' | 'orderComplete' | 'disputeOpened';
  payload: Record<string, unknown>;
}

export interface ImageJobData {
  imageId: string;
  r2Key: string;
  userId: string;
}

export interface PayoutJobData {
  orderId: string;
  sellerId: string;
  amountNzd: number;
  stripeAccountId: string;
}

export interface NotificationJobData {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}
