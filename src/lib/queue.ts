// src/lib/queue.ts  (Sprint 4)
// ─── BullMQ Job Queues ───────────────────────────────────────────────────────
// Connects to Upstash Redis via ioredis for background job processing.
// Queues:
//   • emailQueue        — non-blocking email sending (5 retries, jitter backoff)
//   • imageQueue        — scan + resize pipeline (3 retries, jitter backoff)
//   • payoutQueue       — payout processing (5 retries, long delays + jitter)
//   • notificationQueue — push notifications (3 retries, fast + jitter)
//   • pickupQueue       — OTP pickup confirmation (3 retries, jitter backoff)
//
// All jobs are idempotent — safe to run twice without side effects.

import { Queue } from "bullmq";
import { getQueueConnection } from "@/infrastructure/queue/client";

export { getQueueConnection };

// ── Jitter backoff factory ───────────────────────────────────────────────────

/**
 * Creates a BullMQ custom backoff strategy function that applies exponential
 * delay with random jitter to prevent retry storms during partial provider
 * outages (e.g. Resend, Stripe, or R2 experiencing elevated error rates).
 *
 * Formula: baseDelayMs × 2^attemptsMade + random(0, jitterMs)
 *
 * Pass the returned function to the Worker that processes this queue:
 *   new Worker(name, processor, {
 *     settings: { backoffStrategy: config.backoffStrategy }
 *   })
 *
 * The queue's defaultJobOptions must set backoff.type = 'custom' for BullMQ
 * to invoke this function instead of its built-in exponential algorithm.
 *
 * @param baseDelayMs — initial delay in milliseconds (doubled on each retry)
 * @param jitterMs    — upper bound of the random jitter added per retry
 */
function makeBackoffStrategy(
  baseDelayMs: number,
  jitterMs: number,
): (attemptsMade: number) => number {
  return (attemptsMade: number): number =>
    baseDelayMs * Math.pow(2, attemptsMade) + Math.random() * jitterMs;
}

// ── Queue config type ────────────────────────────────────────────────────────

/**
 * Per-queue configuration: BullMQ defaultJobOptions combined with the
 * corresponding custom backoff strategy for the Worker.
 *
 * Exported so worker files and tests can reference queue-specific settings
 * without reaching into the queue module internals.
 */
export interface QueueConfig {
  /** Passed directly to Queue({ defaultJobOptions }). */
  jobOptions: {
    attempts: number;
    backoff: { type: string; delay?: number };
    removeOnComplete: { count: number };
    removeOnFail: boolean;
  };
  /**
   * Custom backoff strategy for Worker settings.
   *
   * @example
   *   new Worker(name, processor, {
   *     settings: { backoffStrategy: config.backoffStrategy }
   *   })
   *
   * Returns the delay in milliseconds before the next retry attempt.
   * @param attemptsMade — number of prior attempts (zero-indexed)
   */
  backoffStrategy: (attemptsMade: number) => number;
}

// ── Per-queue configs ────────────────────────────────────────────────────────

/**
 * Email queue — non-critical timing; Resend may be slow under load.
 * 5 retries allow several hours of provider downtime before permanent failure.
 * Jitter spread: 0–1,000 ms per retry.
 */
export const EMAIL_QUEUE_CONFIG: QueueConfig = {
  jobOptions: {
    attempts: 5,
    backoff: { type: "custom" },
    removeOnComplete: { count: 100 },
    removeOnFail: false,
  },
  backoffStrategy: makeBackoffStrategy(2000, 1000),
};

/**
 * Image queue — idempotent R2 uploads; safe to retry without side effects.
 * Longer base delay accounts for R2 propagation latency after a partial write.
 * Jitter spread: 0–1,500 ms per retry.
 */
export const IMAGE_QUEUE_CONFIG: QueueConfig = {
  jobOptions: {
    attempts: 3,
    backoff: { type: "custom" },
    removeOnComplete: { count: 50 },
    removeOnFail: false,
  },
  backoffStrategy: makeBackoffStrategy(3000, 1500),
};

/**
 * Payout queue — financial and critical. Long base delay reduces the risk of
 * double-payout during transient Stripe errors; 5 retries cover multi-hour
 * Stripe Connect incidents. High removeOnComplete count supports audit trails.
 * Jitter spread: 0–2,000 ms per retry.
 */
export const PAYOUT_QUEUE_CONFIG: QueueConfig = {
  jobOptions: {
    attempts: 5,
    backoff: { type: "custom" },
    removeOnComplete: { count: 500 },
    removeOnFail: false,
  },
  backoffStrategy: makeBackoffStrategy(10000, 2000),
};

/**
 * Notification queue — best-effort delivery; fast turnaround matters more than
 * exhaustive retrying. Short base delay keeps push notifications timely.
 * Jitter spread: 0–500 ms per retry.
 */
export const NOTIFICATION_QUEUE_CONFIG: QueueConfig = {
  jobOptions: {
    attempts: 3,
    backoff: { type: "custom" },
    removeOnComplete: { count: 200 },
    removeOnFail: false,
  },
  backoffStrategy: makeBackoffStrategy(1000, 500),
};

/**
 * Pickup queue — time-sensitive OTP confirmation flows.
 * Short delays keep the in-person handover experience responsive; 3 attempts
 * is sufficient for transient Redis blips without stalling the buyer handover.
 * Jitter spread: 0–500 ms per retry.
 */
export const PICKUP_QUEUE_CONFIG: QueueConfig = {
  jobOptions: {
    attempts: 3,
    backoff: { type: "custom" },
    removeOnComplete: { count: 100 },
    removeOnFail: false,
  },
  backoffStrategy: makeBackoffStrategy(2000, 500),
};

// ── Deprecated default job options ───────────────────────────────────────────
// removeOnFail: false keeps ALL failed jobs in the "failed" set, forming a
// dead-letter queue. Operators can inspect and retry them via the admin API.

/**
 * @deprecated Use the per-queue config constants instead:
 *   EMAIL_QUEUE_CONFIG, IMAGE_QUEUE_CONFIG, PAYOUT_QUEUE_CONFIG,
 *   NOTIFICATION_QUEUE_CONFIG, PICKUP_QUEUE_CONFIG.
 *
 * Retained for backward compatibility — callers that reference
 * DEFAULT_JOB_OPTIONS directly (e.g. dlq tests) will continue to compile and
 * run without changes. New queues must use per-queue configs.
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
};

// ── Lazy queue factory ───────────────────────────────────────────────────────
// Queue instances are created on first method access, not at module evaluation
// time. This prevents getQueueConnection() (which throws when REDIS_URL is
// absent) from running during Next.js build-time static page generation.
//
// The Proxy forwards every property access to the real Queue instance, which is
// created exactly once per export. The exported API (emailQueue.add(...) etc.)
// is identical to a plain Queue — callers need no changes.
//
// When a per-queue config is provided, its jobOptions are used as
// defaultJobOptions. Otherwise the deprecated DEFAULT_JOB_OPTIONS apply as a
// safe fallback for any callers that do not yet supply a config.

function lazyQueue(name: string, config?: QueueConfig): Queue {
  let instance: Queue | null = null;
  const getInstance = (): Queue => {
    if (!instance) {
      instance = new Queue(name, {
        // BullMQ bundles its own ioredis types which conflict with the
        // project's ioredis. The runtime connection works correctly — this
        // cast bridges the type mismatch.
        connection:
          getQueueConnection() as unknown as import("bullmq").ConnectionOptions,
        defaultJobOptions: config?.jobOptions ?? DEFAULT_JOB_OPTIONS,
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

export const emailQueue = lazyQueue("email", EMAIL_QUEUE_CONFIG);
export const imageQueue = lazyQueue("image", IMAGE_QUEUE_CONFIG);
export const payoutQueue = lazyQueue("payout", PAYOUT_QUEUE_CONFIG);
export const notificationQueue = lazyQueue(
  "notification",
  NOTIFICATION_QUEUE_CONFIG,
);
export const pickupQueue = lazyQueue("pickup", PICKUP_QUEUE_CONFIG);

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
  | {
      /** Sent to the seller when a payout transfer has been initiated. */
      template: "payoutInitiated";
      to: string;
      sellerName: string;
      /** Payout amount in NZD cents. */
      amountNzd: number;
      listingTitle: string;
      orderId: string;
      estimatedArrival: string;
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
