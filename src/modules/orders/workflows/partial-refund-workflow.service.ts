// src/modules/orders/workflows/partial-refund-workflow.service.ts
// ─── Partial Refund Workflow ──────────────────────────────────────────────────
// requestPartialRefund  — buyer or seller initiates a partial refund request
// respondToPartialRefund — the other party accepts, rejects, or counter-offers

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
import { toCents, formatCentsAsNzd } from "@/lib/currency";

import type { ServiceResult } from "@/shared/types/service-result";

export async function requestPartialRefund(
  userId: string,
  orderId: string,
  reason: string,
  amount: number,
): Promise<ServiceResult<{ interactionId: string }>> {
  const order = await interactionRepository.findOrderForWorkflow(orderId);
  if (!order) return { ok: false, error: "Order not found." };

  const isBuyer = order.buyerId === userId;
  const isSeller = order.sellerId === userId;
  if (!isBuyer && !isSeller) {
    return { ok: false, error: "You are not a party to this order." };
  }

  if (order.status !== "COMPLETED" && order.status !== "DELIVERED") {
    return {
      ok: false,
      error:
        "Partial refunds can only be requested for completed or delivered orders.",
    };
  }

  const amountCents = toCents(amount);
  if (amountCents > order.totalNzd) {
    return {
      ok: false,
      error: `Amount cannot exceed the order total of ${formatCentsAsNzd(order.totalNzd)}.`,
    };
  }

  const initiatorRole = isBuyer ? "BUYER" : "SELLER";
  const otherPartyId = isBuyer ? order.sellerId : order.buyerId;
  const partialRefundResponseHours = await getConfigInt(
    CONFIG_KEYS.PARTIAL_REFUND_RESPONSE_HOURS,
  );
  const expiresAt = new Date(
    Date.now() + partialRefundResponseHours * MS_PER_HOUR,
  );

  const label = isBuyer ? "Buyer" : "Seller";

  const interaction = await orderRepository.$transaction(async (tx) => {
    const created = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.PARTIAL_REFUND_REQUEST,
      initiatedById: userId,
      initiatorRole: initiatorRole as "BUYER" | "SELLER",
      reason,
      details: { requestedAmount: amountCents, currency: "NZD" },
      expiresAt,
      autoAction: AUTO_ACTIONS.AUTO_ESCALATE,
      tx,
    });
    await orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.PARTIAL_REFUND_REQUESTED,
      actorId: userId,
      actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `${label} requested a partial refund of $${amount.toFixed(2)}: ${reason}`,
      metadata: {
        interactionId: created.id,
        requestedAmount: amountCents,
      },
      tx,
    });
    return created;
  });

  fireAndForget(
    createNotification({
      userId: otherPartyId,
      type: "SYSTEM",
      title: "Partial refund requested",
      body: `${label} has requested a partial refund of $${amount.toFixed(2)} for "${order.listing.title}". You have 48 hours to respond.`,
      orderId,
      link: `/orders/${orderId}`,
    }),
    "interaction.partial_refund.request.notification",
    { orderId, userId: otherPartyId },
  );

  return { ok: true, data: { interactionId: interaction.id } };
}

export async function respondToPartialRefund(
  userId: string,
  interactionId: string,
  action: "ACCEPT" | "REJECT" | "COUNTER",
  responseNote?: string,
  counterAmount?: number,
): Promise<ServiceResult<void>> {
  if (action === "REJECT" && (!responseNote || responseNote.length < 10)) {
    return {
      ok: false,
      error: "Please provide a reason for rejecting (at least 10 characters).",
    };
  }
  if (action === "COUNTER" && !counterAmount) {
    return { ok: false, error: "Please provide a counter-offer amount." };
  }

  const serviceAction = action === "COUNTER" ? "REJECT" : action;
  const { interaction } = await orderInteractionService.respondToInteraction(
    interactionId,
    userId,
    serviceAction as "ACCEPT" | "REJECT",
    responseNote,
  );

  if (action === "COUNTER") {
    const counterCents = toCents(counterAmount!);
    await interactionRepository.updateInteractionCounter(interactionId, {
      ...(interaction.details as Record<string, unknown> | null),
      counterAmount: counterCents,
      counterCurrency: "NZD",
    } as import("@prisma/client").Prisma.InputJsonValue);
  }

  const order = await interactionRepository.findOrderForWorkflow(
    interaction.orderId,
  );

  const isBuyer = userId === order?.buyerId;
  const responderRole = isBuyer ? "Buyer" : "Seller";

  if (action === "ACCEPT") {
    // CRITICAL: resolution update and event recording are atomic — a crash
    // between the two would mark the interaction resolved with no event entry,
    // leaving the refund approval invisible on the order timeline.
    await orderRepository.$transaction(async (tx) => {
      await interactionRepository.updateInteractionResolution(
        interactionId,
        "PARTIAL_REFUND",
        tx,
      );

      await orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_APPROVED,
        actorId: userId,
        actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
        summary: `${responderRole} approved the partial refund request`,
        metadata: { interactionId },
        tx,
      });
    });

    fireAndForget(
      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Partial refund approved",
        body: `Your partial refund request for "${order?.listing.title}" has been approved.`,
        orderId: interaction.orderId,
        link: `/orders/${interaction.orderId}`,
      }),
      "interaction.partial_refund.approved.notification",
      { orderId: interaction.orderId, userId: interaction.initiatedById },
    );
  } else if (action === "COUNTER") {
    // Fire-and-forget: updateInteractionCounter() ran unconditionally above
    // before the ACCEPT/COUNTER/REJECT branch. Atomising would require
    // restructuring the control flow — out of scope.
    orderEventService.recordEvent({
      orderId: interaction.orderId,
      type: ORDER_EVENT_TYPES.PARTIAL_REFUND_REQUESTED,
      actorId: userId,
      actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `${responderRole} counter-offered $${counterAmount!.toFixed(2)} for the partial refund`,
      metadata: {
        interactionId,
        counterAmount: toCents(counterAmount!),
      },
    });

    fireAndForget(
      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Counter-offer received",
        body: `${responderRole} counter-offered $${counterAmount!.toFixed(2)} on your partial refund request for "${order?.listing.title}".`,
        orderId: interaction.orderId,
        link: `/orders/${interaction.orderId}`,
      }),
      "interaction.partial_refund.counter.notification",
      { orderId: interaction.orderId, userId: interaction.initiatedById },
    );
  } else {
    // Fire-and-forget: respondToInteraction() updated the interaction status
    // without exposing a tx handle — out of scope to thread here.
    orderEventService.recordEvent({
      orderId: interaction.orderId,
      type: ORDER_EVENT_TYPES.PARTIAL_REFUND_REQUESTED,
      actorId: userId,
      actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `${responderRole} rejected the partial refund request${responseNote ? `: ${responseNote}` : ""}`,
      metadata: { interactionId, responseNote },
    });

    fireAndForget(
      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Partial refund rejected",
        body: `Your partial refund request for "${order?.listing.title}" was declined.`,
        orderId: interaction.orderId,
        link: `/orders/${interaction.orderId}`,
      }),
      "interaction.partial_refund.rejected.notification",
      { orderId: interaction.orderId, userId: interaction.initiatedById },
    );
  }

  return { ok: true, data: undefined };
}
