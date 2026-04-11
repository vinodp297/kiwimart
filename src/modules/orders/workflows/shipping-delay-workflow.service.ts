// src/modules/orders/workflows/shipping-delay-workflow.service.ts
// ─── Shipping Delay Workflow + Interaction Query ──────────────────────────────
// notifyShippingDelay   — seller notifies the buyer of a shipping delay
// respondToShippingDelay — buyer acknowledges or disputes the delay
// getOrderInteractions  — read all interactions for an order

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
import { MS_PER_DAY } from "@/lib/time";
import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { interactionRepository } from "../interaction.repository";
import { orderRepository } from "../order.repository";

import type { ServiceResult } from "@/shared/types/service-result";

export async function notifyShippingDelay(
  userId: string,
  orderId: string,
  reason: string,
  estimatedNewDate?: string,
): Promise<ServiceResult<{ interactionId: string }>> {
  const order = await interactionRepository.findOrderForWorkflow(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.sellerId !== userId) {
    return {
      ok: false,
      error: "Only the seller can notify about shipping delays.",
    };
  }
  if (order.status !== "PAYMENT_HELD" && order.status !== "AWAITING_PAYMENT") {
    return {
      ok: false,
      error:
        "Shipping delay notifications are only applicable before dispatch.",
    };
  }

  const shippingDelayDays = await getConfigInt(
    CONFIG_KEYS.SHIPPING_DELAY_NOTIFICATION_DAYS,
  );
  const expiresAt = new Date(Date.now() + shippingDelayDays * MS_PER_DAY);

  const interaction = await orderInteractionService.createInteraction({
    orderId,
    type: INTERACTION_TYPES.SHIPPING_DELAY,
    initiatedById: userId,
    initiatorRole: "SELLER",
    reason,
    details: {
      delayReason: reason,
      ...(estimatedNewDate ? { newEstimatedDate: estimatedNewDate } : {}),
    },
    expiresAt,
    autoAction: AUTO_ACTIONS.AUTO_APPROVE,
  });

  // Fire-and-forget: createInteraction() writes without exposing a tx handle.
  // Atomising with that write requires changes to OrderInteractionService —
  // out of scope for this tx-threading pass.
  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.SHIPPING_DELAY_NOTIFIED,
    actorId: userId,
    actorRole: ACTOR_ROLES.SELLER,
    summary: `Seller notified of shipping delay: ${reason}${estimatedNewDate ? ` (new estimate: ${estimatedNewDate})` : ""}`,
    metadata: {
      interactionId: interaction.id,
      newEstimatedDate: estimatedNewDate,
    },
  });

  fireAndForget(
    createNotification({
      userId: order.buyerId,
      type: "SYSTEM",
      title: "Shipping delay",
      body: `The seller has notified a shipping delay for "${order.listing.title}": ${reason}`,
      orderId,
      link: `/orders/${orderId}`,
    }),
    "interaction.shipping_delay.notification",
    { orderId, buyerId: order.buyerId },
  );

  return { ok: true, data: { interactionId: interaction.id } };
}

export async function respondToShippingDelay(
  userId: string,
  interactionId: string,
  action: "ACCEPT" | "REJECT",
  responseNote?: string,
): Promise<ServiceResult<void>> {
  const { interaction } = await orderInteractionService.respondToInteraction(
    interactionId,
    userId,
    action,
    responseNote,
  );

  // Fetch order before the transaction so the notification body can use
  // the listing title without a second query inside the tx.
  const order = await interactionRepository.findOrderForWorkflow(
    interaction.orderId,
  );

  // CRITICAL: resolution update (ACCEPT only) and event recording are
  // atomic — a crash between the two would leave the interaction dismissed
  // with no timeline entry, hiding the buyer's acknowledgement.
  await orderRepository.$transaction(async (tx) => {
    if (action === "ACCEPT") {
      await interactionRepository.updateInteractionResolution(
        interactionId,
        "DISMISSED",
        tx,
      );
    }

    await orderEventService.recordEvent({
      orderId: interaction.orderId,
      type: ORDER_EVENT_TYPES.SHIPPING_DELAY_NOTIFIED,
      actorId: userId,
      actorRole: ACTOR_ROLES.BUYER,
      summary:
        action === "ACCEPT"
          ? "Buyer acknowledged the shipping delay"
          : `Buyer did not accept the shipping delay${responseNote ? `: ${responseNote}` : ""}`,
      metadata: { interactionId, action },
      tx,
    });
  });

  fireAndForget(
    createNotification({
      userId: interaction.initiatedById,
      type: "SYSTEM",
      title:
        action === "ACCEPT"
          ? "Delay acknowledged"
          : "Buyer did not accept delay",
      body:
        action === "ACCEPT"
          ? `The buyer acknowledged the shipping delay for "${order?.listing.title}".`
          : `The buyer did not accept the shipping delay for "${order?.listing.title}". They may request a cancellation.`,
      orderId: interaction.orderId,
      link: `/orders/${interaction.orderId}`,
    }),
    "interaction.shipping_delay.response.notification",
    { orderId: interaction.orderId, userId: interaction.initiatedById },
  );

  return { ok: true, data: undefined };
}

export async function getOrderInteractions(
  orderId: string,
  userId: string,
  isAdmin: boolean,
) {
  const parties = await interactionRepository.findOrderParties(orderId);
  if (!parties) return { ok: false as const, error: "Order not found." };

  const isParty =
    parties.buyerId === userId || parties.sellerId === userId || isAdmin;
  if (!isParty) {
    return {
      ok: false as const,
      error: "You do not have access to this order.",
    };
  }

  const interactions =
    await orderInteractionService.getInteractionsByOrder(orderId);

  return {
    ok: true as const,
    data: interactions.map((i) => ({
      id: i.id,
      type: i.type,
      status: i.status,
      initiatorRole: i.initiatorRole,
      reason: i.reason,
      details: i.details as Record<string, unknown> | null,
      responseNote: i.responseNote,
      expiresAt: i.expiresAt.toISOString(),
      autoAction: i.autoAction,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      resolution: i.resolution,
      createdAt: i.createdAt.toISOString(),
      initiator: {
        id: i.initiator.id,
        displayName: i.initiator.displayName,
        username: i.initiator.username,
      },
      responder: i.responder
        ? {
            id: i.responder.id,
            displayName: i.responder.displayName,
            username: i.responder.username,
          }
        : null,
    })),
  };
}
