// src/server/workers/pickupWorker.ts
// Processes pickupQueue jobs:
//   1. PICKUP_SCHEDULE_DEADLINE — auto-cancel if no time agreed within 48h
//   2. PICKUP_WINDOW_EXPIRED — seller no-show
//   3. OTP_EXPIRED — buyer no-show
//   4. RESCHEDULE_RESPONSE_EXPIRED — auto-cancel on expired reschedule
//
// All jobs are idempotent — check order/request status before processing.

import { Worker } from "bullmq";
import { getQueueConnection } from "@/lib/queue";
import type { PickupJobData } from "@/lib/queue";
import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { paymentService } from "@/modules/payments/payment.service";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendDisputeResolvedEmail } from "@/server/email";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";

export function startPickupWorker() {
  if (process.env.VERCEL) {
    console.error(
      "worker.pickup: BullMQ workers cannot run on Vercel serverless.",
    );
    return;
  }

  const worker = new Worker<PickupJobData>(
    "pickup",
    async (job) => {
      const { type, orderId, rescheduleRequestId } = job.data;

      switch (type) {
        case "PICKUP_SCHEDULE_DEADLINE":
          return handleScheduleDeadline(orderId);
        case "PICKUP_WINDOW_EXPIRED":
          return handleWindowExpired(orderId);
        case "OTP_EXPIRED":
          return handleOtpExpired(orderId);
        case "RESCHEDULE_RESPONSE_EXPIRED":
          return handleRescheduleExpired(orderId, rescheduleRequestId!);
        default:
          logger.warn("pickup.worker.unknown_type", { type, orderId });
      }
    },
    {
      connection:
        getQueueConnection() as unknown as import("bullmq").ConnectionOptions,
      concurrency: 2,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error("pickup.worker.job_failed", {
      jobId: job?.id,
      type: job?.data?.type,
      orderId: job?.data?.orderId,
      error: err.message,
    });
  });

  worker.on("completed", (job) => {
    logger.info("pickup.worker.job_completed", {
      jobId: job.id,
      type: job.data.type,
      orderId: job.data.orderId,
    });
  });

  return worker;
}

async function handleScheduleDeadline(orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      pickupStatus: true,
      stripePaymentIntentId: true,
      listingId: true,
      listing: { select: { title: true } },
    },
  });

  if (!order) return;

  // Idempotency: only act if still waiting
  if (
    order.pickupStatus !== "AWAITING_SCHEDULE" &&
    order.pickupStatus !== "SCHEDULING"
  ) {
    logger.info("pickup.schedule_deadline.skipped", {
      orderId,
      pickupStatus: order.pickupStatus,
    });
    return;
  }

  await db.$transaction(async (tx) => {
    await transitionOrder(
      orderId,
      "CANCELLED",
      {
        pickupStatus: "CANCELLED",
        pickupCancelledAt: new Date(),
        cancelledBy: "SYSTEM",
        cancelReason: "No pickup time agreed within 48 hours — auto-cancelled",
        cancelledAt: new Date(),
      },
      { tx, fromStatus: order.status },
    );

    if (order.listingId) {
      await tx.listing
        .updateMany({
          where: { id: order.listingId, status: "RESERVED" },
          data: { status: "ACTIVE" },
        })
        .catch(() => {});
    }
  });

  if (order.stripePaymentIntentId) {
    try {
      await paymentService.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        orderId,
      });
    } catch (err) {
      logger.error("pickup.schedule_deadline.refund_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await db.trustMetrics
    .upsert({
      where: { userId: order.sellerId },
      create: {
        userId: order.sellerId,
        totalOrders: 0,
        completedOrders: 0,
        disputeCount: 1,
        disputeRate: 0,
        disputesLast30Days: 1,
        averageResponseHours: null,
        averageRating: null,
        dispatchPhotoRate: 0,
        accountAgeDays: 0,
        isFlaggedForFraud: false,
        lastComputedAt: new Date(),
      },
      update: { disputeCount: { increment: 1 } },
    })
    .catch(() => {});

  createNotification({
    userId: order.buyerId,
    type: "SYSTEM",
    title: "Pickup order auto-cancelled",
    body: `Your pickup order for "${order.listing.title}" was automatically cancelled because no pickup time was agreed within 48 hours.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  createNotification({
    userId: order.sellerId,
    type: "SYSTEM",
    title: "Pickup order cancelled",
    body: `Your pickup order for "${order.listing.title}" was cancelled because you did not agree a pickup time within 48 hours. This may affect your seller rating.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.CANCELLED,
    actorId: null,
    actorRole: ACTOR_ROLES.SYSTEM,
    summary: "Order auto-cancelled: no pickup time agreed within 48 hours",
    metadata: { trigger: "PICKUP_SCHEDULE_DEADLINE" },
  });

  audit({
    userId: null,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: orderId,
    metadata: { trigger: "PICKUP_SCHEDULE_DEADLINE", newStatus: "CANCELLED" },
  });
}

async function handleWindowExpired(orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      pickupStatus: true,
      totalNzd: true,
      stripePaymentIntentId: true,
      listingId: true,
      listing: { select: { title: true } },
    },
  });

  if (!order) return;

  // Idempotency: only act if still SCHEDULED (OTP not initiated)
  if (order.pickupStatus !== "SCHEDULED") {
    logger.info("pickup.window_expired.skipped", {
      orderId,
      pickupStatus: order.pickupStatus,
    });
    return;
  }

  await db.$transaction(async (tx) => {
    await transitionOrder(
      orderId,
      "CANCELLED",
      {
        pickupStatus: "SELLER_NO_SHOW",
        cancelledBy: "SYSTEM",
        cancelReason: "Seller did not show up for pickup",
        cancelledAt: new Date(),
      },
      { tx, fromStatus: order.status },
    );

    if (order.listingId) {
      await tx.listing
        .updateMany({
          where: { id: order.listingId, status: "RESERVED" },
          data: { status: "ACTIVE" },
        })
        .catch(() => {});
    }
  });

  if (order.stripePaymentIntentId) {
    try {
      await paymentService.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        orderId,
      });
    } catch (err) {
      logger.error("pickup.window_expired.refund_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Flag seller for fraud (no-show is a strong signal)
  await db.trustMetrics
    .upsert({
      where: { userId: order.sellerId },
      create: {
        userId: order.sellerId,
        totalOrders: 0,
        completedOrders: 0,
        disputeCount: 1,
        disputeRate: 0,
        disputesLast30Days: 1,
        averageResponseHours: null,
        averageRating: null,
        dispatchPhotoRate: 0,
        accountAgeDays: 0,
        isFlaggedForFraud: true,
        lastComputedAt: new Date(),
      },
      update: {
        disputeCount: { increment: 1 },
        isFlaggedForFraud: true,
      },
    })
    .catch(() => {});

  createNotification({
    userId: order.buyerId,
    type: "SYSTEM",
    title: "Seller no-show — order cancelled",
    body: `The seller did not show up for your pickup. We have automatically cancelled the order and issued a full refund.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  createNotification({
    userId: order.sellerId,
    type: "SYSTEM",
    title: "Missed pickup — order cancelled",
    body: `You missed your pickup appointment and the order has been automatically cancelled. This has been recorded on your account.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  db.user
    .findUnique({
      where: { id: order.buyerId },
      select: { email: true, displayName: true },
    })
    .then((buyer) => {
      if (!buyer) return;
      sendDisputeResolvedEmail({
        to: buyer.email,
        recipientName: buyer.displayName ?? "there",
        recipientRole: "buyer",
        orderId,
        listingTitle: order.listing.title,
        resolution: "BUYER_WON",
        refundAmount: order.totalNzd,
        adminNote: null,
      }).catch(() => {});
    })
    .catch(() => {});

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.CANCELLED,
    actorId: null,
    actorRole: ACTOR_ROLES.SYSTEM,
    summary: "Seller no-show: pickup window expired without OTP initiation",
    metadata: { trigger: "SELLER_NO_SHOW" },
  });

  audit({
    userId: null,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: orderId,
    metadata: { trigger: "SELLER_NO_SHOW_AUTO_CANCELLED" },
  });
}

export async function handleOtpExpired(orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      pickupStatus: true,
      totalNzd: true,
      stripePaymentIntentId: true,
      listingId: true,
      listing: { select: { title: true } },
    },
  });

  if (!order) return;

  // Idempotency: only act if still OTP_INITIATED
  if (order.pickupStatus !== "OTP_INITIATED") {
    logger.info("pickup.otp_expired.skipped", {
      orderId,
      pickupStatus: order.pickupStatus,
    });
    return;
  }

  // Buyer no-show — capture payment first (if online), then complete order.
  // Capture MUST succeed before we mark the order COMPLETED and release the
  // payout to the seller.  If capture fails the order goes to DISPUTED so a
  // human can investigate rather than silently completing with no payment.

  if (order.stripePaymentIntentId) {
    try {
      await paymentService.capturePayment({
        paymentIntentId: order.stripePaymentIntentId,
        orderId,
      });
    } catch (err) {
      logger.error("pickup.otp_expired.capture_failed", {
        orderId,
        paymentIntentId: order.stripePaymentIntentId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Capture failed — transition to DISPUTED for manual review instead
      // of completing the order with no captured payment.
      await db.$transaction(async (tx) => {
        await transitionOrder(
          orderId,
          "DISPUTED",
          {
            pickupStatus: "BUYER_NO_SHOW",
            otpCodeHash: null,
            otpExpiresAt: null,
          },
          { tx, fromStatus: order.status },
        );
      });

      orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.DISPUTE_OPENED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary:
          "Payment capture failed after buyer no-show — requires manual review",
        metadata: {
          trigger: "BUYER_NO_SHOW_CAPTURE_FAILED",
          paymentIntentId: order.stripePaymentIntentId,
          error: err instanceof Error ? err.message : String(err),
        },
      });

      audit({
        userId: null,
        action: "ORDER_STATUS_CHANGED",
        entityType: "Order",
        entityId: orderId,
        metadata: {
          trigger: "BUYER_NO_SHOW_CAPTURE_FAILED",
          newStatus: "DISPUTED",
        },
      });

      // Do NOT throw — the job should complete (not retry), since retrying
      // a failed capture is dangerous.
      return;
    }
  }

  // Payment captured (or cash order with no PI) — safe to complete.
  await db.$transaction(async (tx) => {
    await transitionOrder(
      orderId,
      "COMPLETED",
      {
        pickupStatus: "BUYER_NO_SHOW",
        otpCodeHash: null,
        otpExpiresAt: null,
        pickupConfirmedAt: new Date(),
        completedAt: new Date(),
      },
      { tx, fromStatus: order.status },
    );

    await tx.payout.upsert({
      where: { orderId },
      create: {
        orderId,
        userId: order.sellerId,
        amountNzd: order.totalNzd,
        platformFeeNzd: 0,
        stripeFeeNzd: 0,
        status: "PROCESSING",
        initiatedAt: new Date(),
      },
      update: {
        status: "PROCESSING",
        initiatedAt: new Date(),
      },
    });

    if (order.listingId) {
      await tx.listing
        .update({
          where: { id: order.listingId },
          data: { status: "SOLD", soldAt: new Date() },
        })
        .catch(() => {});
    }
  });

  await db.trustMetrics
    .upsert({
      where: { userId: order.buyerId },
      create: {
        userId: order.buyerId,
        totalOrders: 0,
        completedOrders: 0,
        disputeCount: 1,
        disputeRate: 0,
        disputesLast30Days: 1,
        averageResponseHours: null,
        averageRating: null,
        dispatchPhotoRate: 0,
        accountAgeDays: 0,
        isFlaggedForFraud: false,
        lastComputedAt: new Date(),
      },
      update: {
        disputeCount: { increment: 1 },
        disputesLast30Days: { increment: 1 },
      },
    })
    .catch(() => {});

  createNotification({
    userId: order.buyerId,
    type: "SYSTEM",
    title: "Pickup code expired",
    body: `You did not confirm your pickup within the allowed time. The seller has been paid and the order is complete. If you believe this is an error, please contact support.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  createNotification({
    userId: order.sellerId,
    type: "ORDER_COMPLETED",
    title: "Payment released",
    body: `The buyer did not enter the pickup code in time. Your payment has been automatically released.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.COMPLETED,
    actorId: null,
    actorRole: ACTOR_ROLES.SYSTEM,
    summary: "Buyer no-show: OTP expired — payment released to seller",
    metadata: { trigger: "BUYER_NO_SHOW_AUTO_RELEASED" },
  });

  audit({
    userId: null,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: orderId,
    metadata: {
      trigger: "BUYER_NO_SHOW_AUTO_RELEASED",
      newStatus: "COMPLETED",
    },
  });
}

async function handleRescheduleExpired(
  orderId: string,
  rescheduleRequestId: string,
): Promise<void> {
  const request = await db.pickupRescheduleRequest.findUnique({
    where: { id: rescheduleRequestId },
    select: {
      id: true,
      orderId: true,
      status: true,
      requestedById: true,
      requestedByRole: true,
    },
  });

  if (!request) return;

  // Idempotency: only act if still PENDING
  if (request.status !== "PENDING") {
    logger.info("pickup.reschedule_expired.skipped", {
      rescheduleRequestId,
      status: request.status,
    });
    return;
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      stripePaymentIntentId: true,
      listingId: true,
      listing: { select: { title: true } },
    },
  });

  if (!order) return;

  // Already terminal
  if (
    order.status === "CANCELLED" ||
    order.status === "COMPLETED" ||
    order.status === "REFUNDED"
  ) {
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.pickupRescheduleRequest.update({
      where: { id: rescheduleRequestId },
      data: { status: "EXPIRED" },
    });

    await transitionOrder(
      orderId,
      "CANCELLED",
      {
        pickupStatus: "CANCELLED",
        pickupCancelledAt: new Date(),
        cancelledBy: "SYSTEM",
        cancelReason: "Reschedule request expired without response",
        cancelledAt: new Date(),
      },
      { tx, fromStatus: order.status },
    );

    if (order.listingId) {
      await tx.listing
        .updateMany({
          where: { id: order.listingId, status: "RESERVED" },
          data: { status: "ACTIVE" },
        })
        .catch(() => {});
    }
  });

  if (order.stripePaymentIntentId) {
    try {
      await paymentService.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        orderId,
      });
    } catch (err) {
      logger.error("pickup.reschedule_expired.refund_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const innocentPartyId =
    request.requestedById === order.buyerId ? order.sellerId : order.buyerId;
  const requesterRoleLabel =
    request.requestedByRole === "BUYER" ? "buyer" : "seller";

  await db.trustMetrics
    .upsert({
      where: { userId: request.requestedById },
      create: {
        userId: request.requestedById,
        totalOrders: 0,
        completedOrders: 0,
        disputeCount: 1,
        disputeRate: 0,
        disputesLast30Days: 1,
        averageResponseHours: null,
        averageRating: null,
        dispatchPhotoRate: 0,
        accountAgeDays: 0,
        isFlaggedForFraud: false,
        lastComputedAt: new Date(),
      },
      update: { disputeCount: { increment: 1 } },
    })
    .catch(() => {});

  createNotification({
    userId: innocentPartyId,
    type: "SYSTEM",
    title: "Pickup order cancelled",
    body: `The ${requesterRoleLabel} did not respond to the reschedule request within 12 hours. The order has been automatically cancelled and you have been refunded.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  createNotification({
    userId: request.requestedById,
    type: "SYSTEM",
    title: "Reschedule request expired",
    body: `Your reschedule request expired without a response. The order has been cancelled.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.CANCELLED,
    actorId: null,
    actorRole: ACTOR_ROLES.SYSTEM,
    summary: `Order auto-cancelled: reschedule request from ${requesterRoleLabel} expired without response`,
    metadata: {
      trigger: "RESCHEDULE_RESPONSE_EXPIRED",
      rescheduleRequestId,
    },
  });

  audit({
    userId: null,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: orderId,
    metadata: {
      trigger: "RESCHEDULE_RESPONSE_EXPIRED",
      rescheduleRequestId,
    },
  });
}
