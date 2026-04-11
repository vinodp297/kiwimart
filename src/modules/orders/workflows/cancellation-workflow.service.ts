// src/modules/orders/workflows/cancellation-workflow.service.ts
// ─── Cancellation Workflow ────────────────────────────────────────────────────
// requestCancellation  — buyer or seller initiates a cancellation
// respondToCancellation — the other party accepts or rejects

import { logger } from "@/shared/logger";
import { orderService } from "../order.service";
import { paymentService } from "@/modules/payments/payment.service";
import {
  orderInteractionService,
  INTERACTION_TYPES,
  AUTO_ACTIONS,
} from "../order-interaction.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "../order-event.service";
import { createNotification } from "@/modules/notifications/notification.service";
import { fireAndForget } from "@/lib/fire-and-forget";
import { MS_PER_HOUR } from "@/lib/time";
import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { interactionRepository } from "../interaction.repository";
import { orderRepository } from "../order.repository";

import type { ServiceResult } from "@/shared/types/service-result";

export async function requestCancellation(
  userId: string,
  orderId: string,
  reason: string,
): Promise<ServiceResult<{ autoApproved: boolean; interactionId?: string }>> {
  const [FREE_CANCEL_WINDOW_MINUTES, CANCEL_REQUEST_WINDOW_HOURS] =
    await Promise.all([
      getConfigInt(CONFIG_KEYS.FREE_CANCEL_WINDOW_MINUTES),
      getConfigInt(CONFIG_KEYS.CANCEL_REQUEST_WINDOW_HOURS),
    ]);

  const order = await interactionRepository.findOrderForWorkflow(orderId);
  if (!order) return { ok: false, error: "Order not found." };

  const isBuyer = order.buyerId === userId;
  const isSeller = order.sellerId === userId;
  if (!isBuyer && !isSeller) {
    return { ok: false, error: "You are not a party to this order." };
  }

  if (order.status !== "AWAITING_PAYMENT" && order.status !== "PAYMENT_HELD") {
    return {
      ok: false,
      error:
        order.status === "DISPATCHED" || order.status === "DELIVERED"
          ? "Cannot cancel after dispatch. Please open a dispute instead."
          : "This order cannot be cancelled at this stage.",
    };
  }

  const initiatorRole = isBuyer ? "BUYER" : "SELLER";
  const otherPartyId = isBuyer ? order.sellerId : order.buyerId;
  const hoursSinceCreation =
    (Date.now() - new Date(order.createdAt).getTime()) / MS_PER_HOUR;
  const isInFreeWindow =
    hoursSinceCreation * 60 < FREE_CANCEL_WINDOW_MINUTES &&
    order.status === "PAYMENT_HELD";

  // Free cancellation window
  if (isInFreeWindow) {
    await orderService.cancelOrder(orderId, userId, reason);

    if (order.stripePaymentIntentId && order.status === "PAYMENT_HELD") {
      try {
        await paymentService.refundPayment({
          paymentIntentId: order.stripePaymentIntentId,
          orderId,
        });
      } catch (refundErr) {
        logger.error("interaction.cancel.refund_failed", {
          orderId,
          error:
            refundErr instanceof Error ? refundErr.message : String(refundErr),
        });
      }
    }

    // Fire-and-forget: orderService.cancelOrder() already committed the
    // CANCELLED event inside its own transaction. These two supplemental
    // events describe WHY the cancellation occurred; there is no DB write
    // in this scope to be atomic with.
    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.CANCEL_REQUESTED,
      actorId: userId,
      actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `${initiatorRole === "BUYER" ? "Buyer" : "Seller"} requested cancellation (free window): ${reason}`,
      metadata: { reason, autoApproved: true },
    });

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.CANCEL_AUTO_APPROVED,
      actorId: null,
      actorRole: ACTOR_ROLES.SYSTEM,
      summary: `Cancellation auto-approved (within ${FREE_CANCEL_WINDOW_MINUTES}-minute free cancellation window)`,
    });

    fireAndForget(
      createNotification({
        userId: otherPartyId,
        type: "SYSTEM",
        title: "Order cancelled",
        body: `${initiatorRole === "BUYER" ? "The buyer" : "The seller"} cancelled the order for "${order.listing.title}". A refund has been initiated.`,
        orderId,
        link: `/orders/${orderId}`,
      }),
      "interaction.cancel.free_window.notification",
      { orderId, userId: otherPartyId },
    );

    return { ok: true, data: { autoApproved: true } };
  }

  // Outside free window — check request window
  if (hoursSinceCreation > CANCEL_REQUEST_WINDOW_HOURS) {
    return {
      ok: false,
      error: `Cancellation requests must be made within ${CANCEL_REQUEST_WINDOW_HOURS} hours of placing the order.`,
    };
  }

  // Create interaction for the other party to respond
  const expiresAt = new Date(Date.now() + 48 * MS_PER_HOUR);

  const interaction = await orderRepository.$transaction(async (tx) => {
    const created = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.CANCEL_REQUEST,
      initiatedById: userId,
      initiatorRole: initiatorRole as "BUYER" | "SELLER",
      reason,
      expiresAt,
      autoAction: AUTO_ACTIONS.AUTO_APPROVE,
      tx,
    });
    await orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.CANCEL_REQUESTED,
      actorId: userId,
      actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `${initiatorRole === "BUYER" ? "Buyer" : "Seller"} requested cancellation: ${reason}`,
      metadata: {
        reason,
        interactionId: created.id,
        expiresAt: expiresAt.toISOString(),
      },
      tx,
    });
    return created;
  });

  fireAndForget(
    createNotification({
      userId: otherPartyId,
      type: "SYSTEM",
      title: "Cancellation requested",
      body: `${initiatorRole === "BUYER" ? "The buyer" : "The seller"} has requested to cancel the order for "${order.listing.title}". You have 48 hours to respond.`,
      orderId,
      link: `/orders/${orderId}`,
    }),
    "interaction.cancel.request.notification",
    { orderId, userId: otherPartyId },
  );

  return {
    ok: true,
    data: { autoApproved: false, interactionId: interaction.id },
  };
}

export async function respondToCancellation(
  userId: string,
  interactionId: string,
  action: "ACCEPT" | "REJECT",
  responseNote?: string,
): Promise<ServiceResult<void>> {
  if (action === "REJECT" && (!responseNote || responseNote.length < 10)) {
    return {
      ok: false,
      error: "Please provide a reason for rejecting (at least 10 characters).",
    };
  }

  const { interaction } = await orderInteractionService.respondToInteraction(
    interactionId,
    userId,
    action,
    responseNote,
  );

  const order = await interactionRepository.findOrderForWorkflow(
    interaction.orderId,
  );
  if (!order) return { ok: false, error: "Order not found." };

  const isBuyer = userId === order.buyerId;
  const responderRole = isBuyer ? "Buyer" : "Seller";

  if (action === "ACCEPT") {
    await orderService.cancelOrder(
      interaction.orderId,
      interaction.initiatedById,
      interaction.reason,
    );

    if (order.stripePaymentIntentId && order.status === "PAYMENT_HELD") {
      try {
        await paymentService.refundPayment({
          paymentIntentId: order.stripePaymentIntentId,
          orderId: order.id,
        });
      } catch (refundErr) {
        logger.error("interaction.cancel.accept.refund_failed", {
          orderId: order.id,
          interactionId,
          error:
            refundErr instanceof Error ? refundErr.message : String(refundErr),
        });
      }
    }

    // Fire-and-forget: orderService.cancelOrder() committed the order
    // status transition and its CANCELLED event inside its own transaction.
    orderEventService.recordEvent({
      orderId: interaction.orderId,
      type: ORDER_EVENT_TYPES.CANCEL_APPROVED,
      actorId: userId,
      actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `${responderRole} approved the cancellation request`,
      metadata: { interactionId },
    });

    fireAndForget(
      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Cancellation approved",
        body: `Your cancellation request for "${order.listing.title}" has been approved. A refund has been initiated.`,
        orderId: order.id,
        link: `/orders/${order.id}`,
      }),
      "interaction.cancel.approved.notification",
      { orderId: order.id, userId: interaction.initiatedById },
    );
  } else {
    // Fire-and-forget: respondToInteraction() updated the interaction status
    // inside order-interaction.service.ts without exposing a tx handle.
    orderEventService.recordEvent({
      orderId: interaction.orderId,
      type: ORDER_EVENT_TYPES.CANCEL_REJECTED,
      actorId: userId,
      actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `${responderRole} rejected the cancellation request${responseNote ? `: ${responseNote}` : ""}`,
      metadata: { interactionId, responseNote },
    });

    fireAndForget(
      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Cancellation rejected",
        body: `Your cancellation request for "${order.listing.title}" was declined. You can open a dispute if you believe this is unfair.`,
        orderId: order.id,
        link: `/orders/${order.id}`,
      }),
      "interaction.cancel.rejected.notification",
      { orderId: order.id, userId: interaction.initiatedById },
    );
  }

  return { ok: true, data: undefined };
}
