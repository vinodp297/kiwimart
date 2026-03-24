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
import IORedis from 'ioredis';

// ── Redis connection (lazy singleton) ────────────────────────────────────────

let _redis: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!_redis) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || redisUrl.includes('PLACEHOLDER')) {
      console.warn('[Queue] No REDIS_URL configured — queues will be unavailable');
      // Return a dummy connection that will fail gracefully
      _redis = new IORedis({
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
    } else {
      _redis = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        tls: redisUrl.startsWith('rediss://') ? {} : undefined,
      });
    }
  }
  return _redis;
}

// ── Queue instances ──────────────────────────────────────────────────────────

const defaultOpts = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: getRedisConnection() as any,
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
  type: 'welcome' | 'passwordReset' | 'offerReceived' | 'offerResponse' | 'orderDispatched' | 'orderComplete';
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
