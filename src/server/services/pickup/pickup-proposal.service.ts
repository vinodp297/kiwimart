// src/server/services/pickup/pickup-proposal.service.ts
// ─── Pickup proposal and acceptance ──────────────────────────────────────────
// Exports: proposePickupTime, acceptPickupTime

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { createNotification } from "@/modules/notifications/notification.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { pickupQueue } from "@/lib/queue";
import { orderRepository } from "@/modules/orders/order.repository";
import { pickupRepository } from "@/modules/pickup/pickup.repository";
import { messageRepository } from "@/modules/messaging/message.repository";
import {
  getPickupConfig,
  findOrCreateThread,
  createPickupMessage,
  formatPickupTime,
} from "./pickup-scheduling.helpers";
import type {
  PickupResult,
  PickupProposalCard,
  PickupConfirmedCard,
} from "./pickup-scheduling.types";

// ── proposePickupTime ─────────────────────────────────────────────────────────

export async function proposePickupTime(params: {
  orderId: string;
  proposedById: string;
  proposedByRole: "BUYER" | "SELLER";
  proposedTime: Date;
}): Promise<PickupResult> {
  const { orderId, proposedById, proposedByRole, proposedTime } = params;

  const order = await orderRepository.findWithPickupContext(orderId);

  if (!order) return { success: false, error: "Order not found." };

  if (
    order.fulfillmentType !== "ONLINE_PAYMENT_PICKUP" &&
    order.fulfillmentType !== "CASH_ON_PICKUP"
  ) {
    return { success: false, error: "This order is not a pickup order." };
  }

  if (order.status !== "AWAITING_PICKUP") {
    return {
      success: false,
      error: "Order is not in a pickup-eligible state.",
    };
  }

  // Validate pickupStatus allows proposals
  const allowedStatuses = new Set([
    "AWAITING_SCHEDULE",
    "SCHEDULING",
    "RESCHEDULING",
  ]);
  if (order.pickupStatus && !allowedStatuses.has(order.pickupStatus)) {
    return {
      success: false,
      error: "Pickup time cannot be proposed at this stage.",
    };
  }

  // Validate proposer is a party to this order
  if (proposedById !== order.buyerId && proposedById !== order.sellerId) {
    return { success: false, error: "You are not a party to this order." };
  }

  // Validate time: at least minimum lead time in the future
  const pickupCfg = await getPickupConfig();
  const now = Date.now();
  if (proposedTime.getTime() - now < pickupCfg.MIN_LEAD_TIME_MS) {
    return {
      success: false,
      error: "Proposed time must be at least 2 hours in the future.",
    };
  }

  // Validate time: not more than max horizon in the future
  if (proposedTime.getTime() - now > pickupCfg.MAX_FUTURE_MS) {
    return {
      success: false,
      error: "Proposed time cannot be more than 30 days in the future.",
    };
  }

  const otherPartyId =
    proposedById === order.buyerId ? order.sellerId : order.buyerId;
  const location =
    order.listing.pickupAddress ?? "Pickup location (see listing)";

  await db.$transaction(async (tx) => {
    // Update pickup status to SCHEDULING
    await orderRepository.updatePickupFields(
      orderId,
      { pickupStatus: "SCHEDULING" },
      tx,
    );

    // Create pickup proposal message in thread
    const threadId = await findOrCreateThread(
      order.buyerId,
      order.sellerId,
      order.listingId,
      tx,
    );

    const card: PickupProposalCard = {
      type: "PICKUP_PROPOSAL",
      proposedBy: proposedByRole,
      proposedTime: proposedTime.toISOString(),
      location,
    };

    await createPickupMessage(threadId, proposedById, card, tx);
  });

  // Notifications (fire-and-forget)
  const roleLabel = proposedByRole === "BUYER" ? "buyer" : "seller";
  const timeLabel = formatPickupTime(proposedTime);

  createNotification({
    userId: otherPartyId,
    type: "SYSTEM",
    title: "Pickup time proposed",
    body: `The ${roleLabel} proposed pickup for "${order.listing.title}" on ${timeLabel}. Accept or suggest another time.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.ORDER_CREATED, // Reuse — no custom pickup event type needed
    actorId: proposedById,
    actorRole:
      proposedByRole === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
    summary: `${proposedByRole === "BUYER" ? "Buyer" : "Seller"} proposed pickup on ${timeLabel}`,
    metadata: {
      proposedTime: proposedTime.toISOString(),
      action: "PICKUP_PROPOSED",
    },
  });

  logger.info("pickup.proposed", {
    orderId,
    proposedById,
    proposedTime: proposedTime.toISOString(),
  });

  return { success: true };
}

// ── acceptPickupTime ──────────────────────────────────────────────────────────

export async function acceptPickupTime(params: {
  orderId: string;
  acceptedById: string;
  rescheduleRequestId?: string;
}): Promise<PickupResult> {
  const { orderId, acceptedById, rescheduleRequestId } = params;
  const pickupCfg = await getPickupConfig();

  const order = await orderRepository.findWithPickupContext(orderId);

  if (!order) return { success: false, error: "Order not found." };

  if (order.status !== "AWAITING_PICKUP") {
    return {
      success: false,
      error: "Order is not in a pickup-eligible state.",
    };
  }

  // Validate acceptor is a party
  if (acceptedById !== order.buyerId && acceptedById !== order.sellerId) {
    return { success: false, error: "You are not a party to this order." };
  }

  let confirmedTime: Date;

  if (rescheduleRequestId) {
    // Accept a specific reschedule request
    const request =
      await pickupRepository.findRescheduleRequest(rescheduleRequestId);

    if (!request)
      return { success: false, error: "Reschedule request not found." };
    if (request.orderId !== orderId)
      return {
        success: false,
        error: "Request does not belong to this order.",
      };
    if (request.status !== "PENDING")
      return {
        success: false,
        error: "This request has already been responded to.",
      };
    if (request.requestedById === acceptedById) {
      return { success: false, error: "You cannot accept your own proposal." };
    }

    confirmedTime = request.proposedTime;

    await pickupRepository.updateRescheduleRequest(rescheduleRequestId, {
      status: "ACCEPTED",
      respondedAt: new Date(),
    });
  } else {
    // Accept the most recent proposal from the message thread
    // Find the latest PICKUP_PROPOSAL message
    const [p1, p2] = [order.buyerId, order.sellerId].sort();
    const thread = await messageRepository.findThread(
      p1!,
      p2!,
      order.listingId,
    );

    if (!thread) return { success: false, error: "No pickup proposal found." };

    const recentMessages = await messageRepository.findRecentThreadMessages(
      thread.id,
      10,
    );

    let proposalCard: PickupProposalCard | null = null;
    for (const msg of recentMessages) {
      if (msg.body.startsWith('{"type":"PICKUP_PROPOSAL"')) {
        try {
          const parsed = JSON.parse(msg.body) as PickupProposalCard;
          if (parsed.type === "PICKUP_PROPOSAL") {
            // Ensure the acceptor is NOT the proposer
            if (msg.senderId === acceptedById) continue;
            proposalCard = parsed;
            break;
          }
        } catch {
          /* not a valid card */
        }
      }
    }

    if (!proposalCard) {
      return { success: false, error: "No pickup proposal found to accept." };
    }

    confirmedTime = new Date(proposalCard.proposedTime);
  }

  const location =
    order.listing.pickupAddress ?? "Pickup location (see listing)";

  await db.$transaction(async (tx) => {
    await orderRepository.updatePickupFields(
      orderId,
      {
        pickupStatus: "SCHEDULED",
        pickupScheduledAt: confirmedTime,
        pickupWindowExpiresAt: new Date(
          confirmedTime.getTime() + pickupCfg.PICKUP_WINDOW_MS,
        ),
      },
      tx,
    );

    // Create confirmation message in thread
    const threadId = await findOrCreateThread(
      order.buyerId,
      order.sellerId,
      order.listingId,
      tx,
    );

    const card: PickupConfirmedCard = {
      type: "PICKUP_CONFIRMED",
      confirmedTime: confirmedTime.toISOString(),
      location,
    };

    await createPickupMessage(threadId, acceptedById, card, tx);
  });

  // Schedule PICKUP_WINDOW_EXPIRED job
  const windowDelay =
    new Date(confirmedTime.getTime() + pickupCfg.PICKUP_WINDOW_MS).getTime() -
    Date.now();
  const windowJobId = `pickup-window-${orderId}`;
  pickupQueue
    .add(
      "PICKUP_JOB",
      { type: "PICKUP_WINDOW_EXPIRED" as const, orderId },
      { delay: Math.max(windowDelay, 0), jobId: windowJobId },
    )
    .then(() => {
      orderRepository.setPickupWindowJobId(orderId, windowJobId);
    })
    .catch((err) => {
      logger.warn("pickup.window_job.schedule_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  const timeLabel = formatPickupTime(confirmedTime);

  // Notify both parties
  createNotification({
    userId: order.buyerId,
    type: "SYSTEM",
    title: "Pickup time confirmed",
    body: `Pickup for "${order.listing.title}" confirmed: ${timeLabel}`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  createNotification({
    userId: order.sellerId,
    type: "SYSTEM",
    title: "Pickup time confirmed",
    body: `Pickup for "${order.listing.title}" confirmed: ${timeLabel}`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.ORDER_CREATED,
    actorId: acceptedById,
    actorRole:
      acceptedById === order.buyerId ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
    summary: `Pickup confirmed for ${timeLabel}`,
    metadata: {
      confirmedTime: confirmedTime.toISOString(),
      action: "PICKUP_CONFIRMED",
    },
  });

  logger.info("pickup.accepted", {
    orderId,
    acceptedById,
    confirmedTime: confirmedTime.toISOString(),
  });

  return { success: true };
}
