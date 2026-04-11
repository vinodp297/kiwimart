// src/modules/orders/workflows/return-flow.service.ts
// ─── Return Flow ──────────────────────────────────────────────────────────────
// requestReturn     — buyer opens a return request
// respondToReturn   — seller accepts or rejects the return

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
import { sendReturnRequestEmail } from "@/server/email";
import { fireAndForget } from "@/lib/fire-and-forget";
import { MS_PER_HOUR } from "@/lib/time";
import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { interactionRepository } from "../interaction.repository";
import { orderRepository } from "../order.repository";

import type { ServiceResult } from "@/shared/types/service-result";

export async function requestReturn(
  userId: string,
  orderId: string,
  reason: string,
  details?: Record<string, unknown>,
): Promise<ServiceResult<{ interactionId: string }>> {
  const order = await interactionRepository.findOrderForWorkflow(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.buyerId !== userId) {
    return { ok: false, error: "Only the buyer can request a return." };
  }
  if (order.status !== "COMPLETED" && order.status !== "DELIVERED") {
    return {
      ok: false,
      error: "Returns can only be requested for completed or delivered orders.",
    };
  }

  const returnResponseHours = await getConfigInt(
    CONFIG_KEYS.RETURN_RESPONSE_WINDOW_HOURS,
  );
  const expiresAt = new Date(Date.now() + returnResponseHours * MS_PER_HOUR);

  const interaction = await orderRepository.$transaction(async (tx) => {
    const created = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.RETURN_REQUEST,
      initiatedById: userId,
      initiatorRole: "BUYER",
      reason,
      details,
      expiresAt,
      autoAction: AUTO_ACTIONS.AUTO_ESCALATE,
      tx,
    });
    await orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.RETURN_REQUESTED,
      actorId: userId,
      actorRole: ACTOR_ROLES.BUYER,
      summary: `Buyer requested a return: ${reason}`,
      metadata: { interactionId: created.id, ...details },
      tx,
    });
    return created;
  });

  fireAndForget(
    createNotification({
      userId: order.sellerId,
      type: "SYSTEM",
      title: "Return requested",
      body: `The buyer has requested a return for "${order.listing.title}". You have 72 hours to respond.`,
      orderId,
      link: `/orders/${orderId}`,
    }),
    "interaction.return.request.notification",
    { orderId, sellerId: order.sellerId },
  );

  // Fire-and-forget return request email to seller
  fireAndForget(
    interactionRepository.findUserEmailInfo(order.sellerId).then((seller) => {
      if (!seller) return;
      fireAndForget(
        sendReturnRequestEmail({
          to: seller.email,
          recipientName: seller.displayName ?? "there",
          recipientRole: "seller",
          orderId,
          listingTitle: order.listing.title,
          action: "REQUESTED",
          reason: reason ?? null,
          sellerNote: null,
        }),
        "interaction.return.request_email.seller",
        { orderId, sellerId: order.sellerId },
      );
    }),
    "interaction.return.request_email.lookup",
    { orderId },
  );

  return { ok: true, data: { interactionId: interaction.id } };
}

export async function respondToReturn(
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

  if (action === "ACCEPT") {
    // CRITICAL: resolution update and event recording are atomic — a crash
    // between the two would leave the interaction resolved with no timeline
    // entry, making the approval invisible to buyers.
    await orderRepository.$transaction(async (tx) => {
      await interactionRepository.updateInteractionResolution(
        interactionId,
        "RETURNED",
        tx,
      );

      await orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.RETURN_APPROVED,
        actorId: userId,
        actorRole: ACTOR_ROLES.SELLER,
        summary: `Seller approved the return request${responseNote ? `: ${responseNote}` : ""}`,
        metadata: { interactionId },
        tx,
      });
    });

    fireAndForget(
      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Return approved",
        body: `Your return request for "${order?.listing.title}" has been approved. Check the order for return instructions.`,
        orderId: interaction.orderId,
        link: `/orders/${interaction.orderId}`,
      }),
      "interaction.return.approved.notification",
      { orderId: interaction.orderId, userId: interaction.initiatedById },
    );

    // Fire-and-forget return approved email to buyer
    fireAndForget(
      interactionRepository
        .findUserEmailInfo(interaction.initiatedById)
        .then((buyer) => {
          if (!buyer) return;
          fireAndForget(
            sendReturnRequestEmail({
              to: buyer.email,
              recipientName: buyer.displayName ?? "there",
              recipientRole: "buyer",
              orderId: interaction.orderId,
              listingTitle: order?.listing.title ?? "your item",
              action: "APPROVED",
              reason: null,
              sellerNote: responseNote ?? null,
            }),
            "interaction.return.approved_email.buyer",
            { orderId: interaction.orderId },
          );
        }),
      "interaction.return.approved_email.lookup",
      { orderId: interaction.orderId },
    );
  } else {
    // Fire-and-forget: respondToInteraction() updated the interaction status
    // without exposing a tx handle. Threading tx would require modifying
    // order-interaction.service.ts — out of scope.
    orderEventService.recordEvent({
      orderId: interaction.orderId,
      type: ORDER_EVENT_TYPES.RETURN_REJECTED,
      actorId: userId,
      actorRole: ACTOR_ROLES.SELLER,
      summary: `Seller rejected the return request${responseNote ? `: ${responseNote}` : ""}`,
      metadata: { interactionId, responseNote },
    });

    fireAndForget(
      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Return rejected",
        body: `Your return request for "${order?.listing.title}" was declined. You can open a dispute if you believe this is unfair.`,
        orderId: interaction.orderId,
        link: `/orders/${interaction.orderId}`,
      }),
      "interaction.return.rejected.notification",
      { orderId: interaction.orderId, userId: interaction.initiatedById },
    );

    // Fire-and-forget return rejected email to buyer
    fireAndForget(
      interactionRepository
        .findUserEmailInfo(interaction.initiatedById)
        .then((buyer) => {
          if (!buyer) return;
          fireAndForget(
            sendReturnRequestEmail({
              to: buyer.email,
              recipientName: buyer.displayName ?? "there",
              recipientRole: "buyer",
              orderId: interaction.orderId,
              listingTitle: order?.listing.title ?? "your item",
              action: "REJECTED",
              reason: null,
              sellerNote: responseNote ?? null,
            }),
            "interaction.return.rejected_email.buyer",
            { orderId: interaction.orderId },
          );
        }),
      "interaction.return.rejected_email.lookup",
      { orderId: interaction.orderId },
    );
  }

  return { ok: true, data: undefined };
}
