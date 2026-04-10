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

// ── Default job options ──────────────────────────────────────────────────────
// removeOnFail: false keeps ALL failed jobs in the "failed" set, forming a
// dead-letter queue. Operators can inspect and retry them via the admin API.
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
};

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
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
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

// ── Queue name map ───────────────────────────────────────────────────────────
// Used by admin endpoints to look up a queue by its short name.

export type QueueName =
  | "email"
  | "image"
  | "payout"
  | "notification"
  | "pickup";

export const QUEUE_MAP: Record<QueueName, Queue> = {
  email: emailQueue,
  image: imageQueue,
  payout: payoutQueue,
  notification: notificationQueue,
  pickup: pickupQueue,
};

export const VALID_QUEUE_NAMES = Object.keys(QUEUE_MAP) as QueueName[];

export { DEFAULT_JOB_OPTIONS };

// ── Job type definitions ─────────────────────────────────────────────────────

// ── Email job data — discriminated union on `template` ───────────────────────
// Each variant carries exactly the fields needed to render that template.
// `correlationId` and `enqueuedAt` are injected by enqueueEmail().
// NEVER include passwords, tokens, or secret keys in job payloads.

export type EmailJobData = {
  correlationId?: string;
  enqueuedAt?: string;
} & (
  | {
      template: "verification";
      to: string;
      displayName: string;
      verifyUrl: string;
    }
  | { template: "welcome"; to: string; displayName: string }
  | {
      template: "passwordReset";
      to: string;
      displayName: string;
      resetUrl: string;
      expiresInMinutes: number;
    }
  | {
      template: "dataExport";
      to: string;
      displayName: string;
      /** Signed R2 URL — the user clicks this to download their data (24 h TTL). */
      downloadUrl: string;
      /** Human-readable expiry string, e.g. "15 Jan 2026, 3:45 pm". */
      expiresAt: string;
    }
  | { template: "erasureConfirmation"; to: string; displayName: string }
  | {
      template: "erasureRequest";
      to: string;
      displayName: string;
      /** Confirmation link — user clicks to authorise account deletion. */
      confirmUrl: string;
    }
  | {
      template: "adminIdVerification";
      to: string;
      userId: string;
      userEmail: string;
      submittedAt: string;
      adminUrl: string;
    }
  | {
      template: "offerReceived";
      to: string;
      sellerName: string;
      buyerName: string;
      listingTitle: string;
      offerAmount: number;
      listingUrl: string;
    }
  | {
      template: "offerResponse";
      to: string;
      buyerName: string;
      listingTitle: string;
      accepted: boolean;
      listingUrl: string;
    }
  | {
      template: "orderDispatched";
      to: string;
      buyerName: string;
      listingTitle: string;
      trackingNumber?: string;
      trackingUrl?: string;
      orderUrl: string;
    }
  | {
      /** Sent to the buyer when they confirm delivery and the order completes. */
      template: "orderCompleteBuyer";
      to: string;
      buyerName: string;
      sellerName: string;
      listingTitle: string;
      /** Order ID shown in the email for reference (not an internal DB ID). */
      orderId: string;
      /** Total paid in NZD cents. */
      totalNzd: number;
      /** Full URL to the order page e.g. /orders/{id} */
      orderUrl: string;
    }
  | {
      /** Sent to the seller when payment is released on order completion. */
      template: "orderCompleteSeller";
      to: string;
      sellerName: string;
      /** Buyer's first name only — full name is not shared for privacy. */
      buyerFirstName: string;
      listingTitle: string;
      /** Order ID shown in the email for reference. */
      orderId: string;
      /** Total sale amount in NZD cents. */
      totalNzd: number;
      /** Business days until payout arrives in seller's bank account. */
      payoutTimelineDays: number;
      /** Full URL to the seller dashboard. */
      dashboardUrl: string;
    }
  | {
      template: "disputeOpened";
      to: string;
      sellerName: string;
      buyerName: string;
      listingTitle: string;
      orderId: string;
      reason: string;
      description: string;
    }
);

export interface ImageJobData {
  imageId: string;
  r2Key: string;
  userId: string;
  correlationId?: string;
}

export interface PayoutJobData {
  orderId: string;
  sellerId: string;
  amountNzd: number;
  stripeAccountId: string;
  correlationId?: string;
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
  correlationId?: string;
}
