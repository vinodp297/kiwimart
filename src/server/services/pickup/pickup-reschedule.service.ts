// src/server/services/pickup/pickup-reschedule.service.ts
// ─── Pickup reschedule request ────────────────────────────────────────────────
// Exports: requestReschedule

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { createNotification } from "@/modules/notifications/notification.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { pickupQueue } from "@/lib/queue";
import { getRequestContext } from "@/lib/request-context";
import { orderRepository } from "@/modules/orders/order.repository";
import { pickupRepository } from "@/modules/pickup/pickup.repository";
import type {
  SellerRescheduleReason,
  BuyerRescheduleReason,
} from "@prisma/client";
import {
  getPickupConfig,
  findOrCreateThread,
  createPickupMessage,
  formatPickupTime,
  reasonLabel,
} from "./pickup-scheduling.helpers";
import { fireAndForget } from "@/lib/fire-and-forget";
import type {
  PickupResult,
  PickupRescheduleRequestCard,
} from "./pickup-scheduling.types";

// ── requestReschedule ─────────────────────────────────────────────────────────

export async function requestReschedule(params: {
  orderId: string;
  requestedById: string;
  requestedByRole: "BUYER" | "SELLER";
  sellerReason?: SellerRescheduleReason;
  buyerReason?: BuyerRescheduleReason;
  reasonNote?: string;
  proposedTime: Date;
}): Promise<PickupResult> {
  const {
    orderId,
    requestedById,
    requestedByRole,
    sellerReason,
    buyerReason,
    reasonNote,
    proposedTime,
  } = params;
  const pickupCfg = await getPickupConfig();

  const order = await orderRepository.findWithPickupContext(orderId);

  if (!order) return { success: false, error: "Order not found." };

  if (order.status !== "AWAITING_PICKUP") {
    return {
      success: false,
      error: "Order is not in a pickup-eligible state.",
    };
  }

  // Must be SCHEDULED to reschedule
  if (order.pickupStatus !== "SCHEDULED") {
    return {
      success: false,
      error: "Can only reschedule a confirmed pickup time.",
    };
  }

  // Validate party
  if (requestedById !== order.buyerId && requestedById !== order.sellerId) {
    return { success: false, error: "You are not a party to this order." };
  }

  // Validate time: at least 2 hours in future
  const now = Date.now();
  if (proposedTime.getTime() - now < pickupCfg.MIN_LEAD_TIME_MS) {
    return {
      success: false,
      error: "Proposed time must be at least 2 hours in the future.",
    };
  }

  if (proposedTime.getTime() - now > pickupCfg.MAX_FUTURE_MS) {
    return {
      success: false,
      error: "Proposed time cannot be more than 30 days in the future.",
    };
  }

  // Validate reason based on role
  if (requestedByRole === "SELLER" && !sellerReason) {
    return {
      success: false,
      error: "Please select a reason for rescheduling.",
    };
  }
  if (requestedByRole === "BUYER" && !buyerReason) {
    return {
      success: false,
      error: "Please select a reason for rescheduling.",
    };
  }

  // If reason is OTHER, reasonNote is required (min 20 chars)
  const isOther =
    (requestedByRole === "SELLER" && sellerReason === "OTHER") ||
    (requestedByRole === "BUYER" && buyerReason === "OTHER");
  if (isOther && (!reasonNote || reasonNote.trim().length < 20)) {
    return {
      success: false,
      error: "Please provide a genuine reason (at least 20 characters).",
    };
  }

  const newRescheduleCount = order.rescheduleCount + 1;
  const otherPartyId =
    requestedById === order.buyerId ? order.sellerId : order.buyerId;

  let requestId: string;

  await db.$transaction(async (tx) => {
    // Increment reschedule count and set status to RESCHEDULING
    await orderRepository.updatePickupFields(
      orderId,
      {
        pickupStatus: "RESCHEDULING",
        rescheduleCount: newRescheduleCount,
        pickupWindowJobId: null,
      },
      tx,
    );

    // Create PickupRescheduleRequest
    const request = await pickupRepository.createRescheduleRequest(
      {
        orderId,
        requestedById,
        requestedByRole,
        sellerReason: sellerReason ?? null,
        buyerReason: buyerReason ?? null,
        reasonNote: reasonNote ?? null,
        proposedTime,
        expiresAt: new Date(Date.now() + pickupCfg.RESCHEDULE_EXPIRY_MS),
      },
      tx,
    );

    requestId = request.id;

    // Create reschedule request message in thread
    const threadId = await findOrCreateThread(
      order.buyerId,
      order.sellerId,
      order.listingId,
      tx,
    );

    const card: PickupRescheduleRequestCard = {
      type: "PICKUP_RESCHEDULE_REQUEST",
      requestedBy: requestedByRole,
      reason: reasonLabel(sellerReason, buyerReason),
      reasonNote: reasonNote ?? null,
      proposedTime: proposedTime.toISOString(),
      requestId: request.id,
    };

    await createPickupMessage(threadId, requestedById, card, tx);
  });

  // Cancel existing pickup window job
  if (order.pickupScheduledAt) {
    const oldWindowJobId = `pickup-window-${orderId}`;
    fireAndForget(
      pickupQueue.remove(oldWindowJobId),
      "pickup.reschedule.removeWindowJob",
      { orderId },
    );
  }

  // Schedule RESCHEDULE_RESPONSE_EXPIRED job (12 hours)
  const rescheduleJobId = `reschedule-expired-${orderId}-${requestId!}`;
  pickupQueue
    .add(
      "PICKUP_JOB",
      {
        type: "RESCHEDULE_RESPONSE_EXPIRED" as const,
        orderId,
        rescheduleRequestId: requestId!,
        correlationId: getRequestContext()?.correlationId,
      },
      { delay: pickupCfg.RESCHEDULE_EXPIRY_MS, jobId: rescheduleJobId },
    )
    .then(() => {
      pickupRepository.setRescheduleJobId(requestId!, rescheduleJobId);
    })
    .catch((err) => {
      logger.warn("pickup.reschedule_job.schedule_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  const label = requestedByRole === "BUYER" ? "buyer" : "seller";
  const timeLabel = formatPickupTime(proposedTime);
  const reasonText = reasonLabel(sellerReason, buyerReason);

  fireAndForget(
    createNotification({
      userId: otherPartyId,
      type: "SYSTEM",
      title: "Pickup reschedule requested",
      body: `The ${label} would like to reschedule pickup for "${order.listing.title}" to ${timeLabel}. Reason: ${reasonText}`,
      orderId,
      link: `/orders/${orderId}`,
    }),
    "pickup.reschedule.notification",
    { orderId, otherPartyId },
  );

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.ORDER_CREATED,
    actorId: requestedById,
    actorRole:
      requestedByRole === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
    summary: `${requestedByRole === "BUYER" ? "Buyer" : "Seller"} requested reschedule to ${timeLabel}: ${reasonText}`,
    metadata: {
      action: "PICKUP_RESCHEDULE_REQUESTED",
      proposedTime: proposedTime.toISOString(),
      rescheduleCount: newRescheduleCount,
      reason: reasonText,
    },
  });

  logger.info("pickup.reschedule.requested", {
    orderId,
    requestedById,
    proposedTime: proposedTime.toISOString(),
    rescheduleCount: newRescheduleCount,
  });

  // Force-cancel check: if rescheduleCount >= threshold, flag it
  if (newRescheduleCount >= pickupCfg.FORCE_CANCEL_THRESHOLD) {
    return { success: true, forceCancelAvailable: true };
  }

  return { success: true };
}
