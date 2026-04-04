// src/server/services/pickup/pickup-reschedule-respond.service.ts
// ─── Pickup reschedule response ───────────────────────────────────────────────
// Exports: respondToReschedule

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { createNotification } from "@/modules/notifications/notification.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { orderRepository } from "@/modules/orders/order.repository";
import { pickupRepository } from "@/modules/pickup/pickup.repository";
import {
  getPickupConfig,
  findOrCreateThread,
  createPickupMessage,
  formatPickupTime,
} from "./pickup-scheduling.helpers";
import type {
  PickupResult,
  PickupRescheduleResponseCard,
} from "./pickup-scheduling.types";
import { proposePickupTime } from "./pickup-proposal.service";

// ── respondToReschedule ───────────────────────────────────────────────────────

export async function respondToReschedule(params: {
  orderId: string;
  rescheduleRequestId: string;
  respondedById: string;
  response: "ACCEPT" | "REJECT" | "PROPOSE_ALTERNATIVE";
  alternativeTime?: Date;
  responseNote?: string;
}): Promise<PickupResult> {
  const {
    orderId,
    rescheduleRequestId,
    respondedById,
    response,
    alternativeTime,
    responseNote,
  } = params;
  const pickupCfg = await getPickupConfig();

  const order = await orderRepository.findWithPickupContext(orderId);

  if (!order) return { success: false, error: "Order not found." };

  // Validate responder is a party
  if (respondedById !== order.buyerId && respondedById !== order.sellerId) {
    return { success: false, error: "You are not a party to this order." };
  }

  const request =
    await pickupRepository.findRescheduleRequest(rescheduleRequestId);

  if (!request)
    return { success: false, error: "Reschedule request not found." };
  if (request.orderId !== orderId)
    return { success: false, error: "Request does not belong to this order." };

  // Cannot respond to own request
  if (request.requestedById === respondedById) {
    return {
      success: false,
      error: "You cannot respond to your own reschedule request.",
    };
  }

  if (request.status !== "PENDING") {
    return {
      success: false,
      error: "This request has already been responded to.",
    };
  }

  if (request.expiresAt < new Date()) {
    return { success: false, error: "This reschedule request has expired." };
  }

  const respondedByRole: "BUYER" | "SELLER" =
    respondedById === order.buyerId ? "BUYER" : "SELLER";

  if (response === "ACCEPT") {
    // Accept the reschedule — delegate to acceptPickupTime
    await pickupRepository.updateRescheduleRequest(rescheduleRequestId, {
      status: "ACCEPTED",
      respondedAt: new Date(),
      responseNote: responseNote ?? null,
    });

    // Create response card in thread
    await db.$transaction(async (tx) => {
      const threadId = await findOrCreateThread(
        order.buyerId,
        order.sellerId,
        order.listingId,
        tx,
      );

      const card: PickupRescheduleResponseCard = {
        type: "PICKUP_RESCHEDULE_RESPONSE",
        response: "ACCEPTED",
        respondedBy: respondedByRole,
        originalTime: order.pickupScheduledAt?.toISOString() ?? "",
        newTime: request.proposedTime.toISOString(),
      };

      await createPickupMessage(threadId, respondedById, card, tx);

      // Update order to SCHEDULED with new time
      await orderRepository.updatePickupFields(
        orderId,
        {
          pickupStatus: "SCHEDULED",
          pickupScheduledAt: request.proposedTime,
          pickupWindowExpiresAt: new Date(
            request.proposedTime.getTime() + pickupCfg.PICKUP_WINDOW_MS,
          ),
        },
        tx,
      );
    });

    const timeLabel = formatPickupTime(request.proposedTime);

    // Notify both parties
    createNotification({
      userId: order.buyerId,
      type: "SYSTEM",
      title: "Pickup rescheduled",
      body: `Pickup for "${order.listing.title}" confirmed: ${timeLabel}`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    createNotification({
      userId: order.sellerId,
      type: "SYSTEM",
      title: "Pickup rescheduled",
      body: `Pickup for "${order.listing.title}" confirmed: ${timeLabel}`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.ORDER_CREATED,
      actorId: respondedById,
      actorRole:
        respondedByRole === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `Reschedule accepted — pickup confirmed for ${timeLabel}`,
      metadata: {
        action: "PICKUP_RESCHEDULE_ACCEPTED",
        confirmedTime: request.proposedTime.toISOString(),
      },
    });

    logger.info("pickup.reschedule.accepted", { orderId, respondedById });
    return { success: true };
  }

  if (response === "REJECT") {
    await db.$transaction(async (tx) => {
      await pickupRepository.updateRescheduleRequest(
        rescheduleRequestId,
        {
          status: "REJECTED",
          respondedAt: new Date(),
          responseNote: responseNote ?? null,
        },
        tx,
      );

      // Revert to SCHEDULED — original pickupScheduledAt is unchanged
      await orderRepository.updatePickupFields(
        orderId,
        { pickupStatus: "SCHEDULED" },
        tx,
      );

      const threadId = await findOrCreateThread(
        order.buyerId,
        order.sellerId,
        order.listingId,
        tx,
      );

      const card: PickupRescheduleResponseCard = {
        type: "PICKUP_RESCHEDULE_RESPONSE",
        response: "REJECTED",
        respondedBy: respondedByRole,
        originalTime: order.pickupScheduledAt?.toISOString() ?? "",
        newTime: null,
      };

      await createPickupMessage(threadId, respondedById, card, tx);
    });

    createNotification({
      userId: request.requestedById,
      type: "SYSTEM",
      title: "Reschedule request declined",
      body: `Your reschedule request for "${order.listing.title}" was declined. The original pickup time stands.`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.ORDER_CREATED,
      actorId: respondedById,
      actorRole:
        respondedByRole === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `Reschedule request rejected${responseNote ? `: ${responseNote}` : ""}`,
      metadata: { action: "PICKUP_RESCHEDULE_REJECTED", responseNote },
    });

    logger.info("pickup.reschedule.rejected", { orderId, respondedById });
    return { success: true };
  }

  if (response === "PROPOSE_ALTERNATIVE") {
    if (!alternativeTime) {
      return { success: false, error: "Alternative time is required." };
    }

    // Validate alternative time
    const now = Date.now();
    if (alternativeTime.getTime() - now < pickupCfg.MIN_LEAD_TIME_MS) {
      return {
        success: false,
        error: "Alternative time must be at least 2 hours in the future.",
      };
    }
    if (alternativeTime.getTime() - now > pickupCfg.MAX_FUTURE_MS) {
      return {
        success: false,
        error: "Alternative time cannot be more than 30 days in the future.",
      };
    }

    // Reject the original request
    await pickupRepository.updateRescheduleRequest(rescheduleRequestId, {
      status: "REJECTED",
      respondedAt: new Date(),
      responseNote: responseNote ?? null,
    });

    // Counter-proposals do NOT increment rescheduleCount — call proposePickupTime
    const proposeResult = await proposePickupTime({
      orderId,
      proposedById: respondedById,
      proposedByRole: respondedByRole,
      proposedTime: alternativeTime,
    });

    return proposeResult;
  }

  return { success: false, error: "Invalid response." };
}
