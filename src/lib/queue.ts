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

import { Queue } from "bullmq";
import { getQueueConnection } from "@/infrastructure/queue/client";

export { getQueueConnection };

// ── Lazy queue factory ───────────────────────────────────────────────────────
// Queue instances are created on first method access, not at module evaluation
// time. This prevents `getQueueConnection()` (which throws when REDIS_URL is
// absent) from running during Next.js build-time static page generation.
//
// The Proxy forwards every property access to the real Queue instance, which is
// created exactly once per export. The exported API (`emailQueue.add(...)` etc.)
// is identical to a plain Queue — callers need no changes.

function lazyQueue(name: string): Queue {
  let instance: Queue | null = null;
  const getInstance = (): Queue => {
    if (!instance) {
      instance = new Queue(name, {
        // BullMQ bundles its own ioredis types which conflict with the
        // project's ioredis. The runtime connection works correctly — this
        // cast bridges the type mismatch.
        connection:
          getQueueConnection() as unknown as import("bullmq").ConnectionOptions,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      });
    }
    return instance;
  };
  return new Proxy({} as Queue, {
    get(_target, prop) {
      const inst = getInstance();
      const value = (inst as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(inst)
        : value;
    },
  });
}

// ── Queue instances ──────────────────────────────────────────────────────────

export const emailQueue = lazyQueue("email");
export const imageQueue = lazyQueue("image");
export const payoutQueue = lazyQueue("payout");
export const notificationQueue = lazyQueue("notification");
export const pickupQueue = lazyQueue("pickup");

// ── Job type definitions ─────────────────────────────────────────────────────

export interface EmailJobData {
  type:
    | "welcome"
    | "passwordReset"
    | "offerReceived"
    | "offerResponse"
    | "orderDispatched"
    | "orderComplete"
    | "disputeOpened";
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

export type PickupJobType =
  | "PICKUP_SCHEDULE_DEADLINE"
  | "PICKUP_WINDOW_EXPIRED"
  | "OTP_EXPIRED"
  | "RESCHEDULE_RESPONSE_EXPIRED";

export interface PickupJobData {
  type: PickupJobType;
  orderId: string;
  rescheduleRequestId?: string;
}
