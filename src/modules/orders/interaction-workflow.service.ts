// src/modules/orders/interaction-workflow.service.ts
// ─── Interaction Workflow Service ────────────────────────────────────────────
// Orchestrates buyer-seller negotiation workflows (cancellation, return,
// partial refund, shipping delay). Each action goes: request → response.

import { logger } from "@/shared/logger";
import { orderService } from "./order.service";
import { paymentService } from "@/modules/payments/payment.service";
import {
  orderInteractionService,
  INTERACTION_TYPES,
  AUTO_ACTIONS,
} from "./order-interaction.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "./order-event.service";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendReturnRequestEmail } from "@/server/email";
import { fireAndForget } from "@/lib/fire-and-forget";
import { MS_PER_HOUR, MS_PER_DAY } from "@/lib/time";
import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { interactionRepository } from "./interaction.repository";
import { orderRepository } from "./order.repository";
import { toCents, formatCentsAsNzd } from "@/lib/currency";

import type { ServiceResult } from "@/shared/types/service-result";

export class InteractionWorkflowService {
  // ── requestCancellation ─────────────────────────────────────────────────

  async requestCancellation(
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

    if (
      order.status !== "AWAITING_PAYMENT" &&
      order.status !== "PAYMENT_HELD"
    ) {
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
              refundErr instanceof Error
                ? refundErr.message
                : String(refundErr),
          });
        }
      }

      // Fire-and-forget: orderService.cancelOrder() already committed the
      // CANCELLED event inside its own transaction. These two supplemental
      // events describe WHY the cancellation occurred; there is no DB write
      // in this scope to be atomic with. Atomising would require pulling
      // cancelOrder() into an outer transaction — a restructuring beyond
      // the scope of this tx-threading pass.
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

    // Create interaction for seller to respond
    const expiresAt = new Date(Date.now() + 48 * MS_PER_HOUR);

    const interaction = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.CANCEL_REQUEST,
      initiatedById: userId,
      initiatorRole: initiatorRole as "BUYER" | "SELLER",
      reason,
      expiresAt,
      autoAction: AUTO_ACTIONS.AUTO_APPROVE,
    });

    // Fire-and-forget: createInteraction() writes the interaction row without
    // exposing a tx handle. Atomising this event with that write would require
    // OrderInteractionService.createInteraction() to accept tx — a change to
    // another service outside the scope of this tx-threading pass.
    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.CANCEL_REQUESTED,
      actorId: userId,
      actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `${initiatorRole === "BUYER" ? "Buyer" : "Seller"} requested cancellation: ${reason}`,
      metadata: {
        reason,
        interactionId: interaction.id,
        expiresAt: expiresAt.toISOString(),
      },
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

  // ── respondToCancellation ───────────────────────────────────────────────

  async respondToCancellation(
    userId: string,
    interactionId: string,
    action: "ACCEPT" | "REJECT",
    responseNote?: string,
  ): Promise<ServiceResult<void>> {
    if (action === "REJECT" && (!responseNote || responseNote.length < 10)) {
      return {
        ok: false,
        error:
          "Please provide a reason for rejecting (at least 10 characters).",
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
              refundErr instanceof Error
                ? refundErr.message
                : String(refundErr),
          });
        }
      }

      // Fire-and-forget: orderService.cancelOrder() committed the order
      // status transition and its CANCELLED event inside its own transaction.
      // This supplemental CANCEL_APPROVED event records the responder's
      // decision; there is no DB write in this scope to be atomic with.
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
      // Threading tx here would require modifying that service — out of scope.
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

  // ── requestReturn ─────────────────────────────────────────────────────

  async requestReturn(
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
        error:
          "Returns can only be requested for completed or delivered orders.",
      };
    }

    const returnResponseHours = await getConfigInt(
      CONFIG_KEYS.RETURN_RESPONSE_WINDOW_HOURS,
    );
    const expiresAt = new Date(Date.now() + returnResponseHours * MS_PER_HOUR);

    const interaction = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.RETURN_REQUEST,
      initiatedById: userId,
      initiatorRole: "BUYER",
      reason,
      details,
      expiresAt,
      autoAction: AUTO_ACTIONS.AUTO_ESCALATE,
    });

    // Fire-and-forget: createInteraction() writes the interaction row without
    // exposing a tx handle. Atomising requires OrderInteractionService to
    // accept tx — out of scope for this tx-threading pass.
    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.RETURN_REQUESTED,
      actorId: userId,
      actorRole: ACTOR_ROLES.BUYER,
      summary: `Buyer requested a return: ${reason}`,
      metadata: { interactionId: interaction.id, ...details },
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

  // ── respondToReturn ───────────────────────────────────────────────────

  async respondToReturn(
    userId: string,
    interactionId: string,
    action: "ACCEPT" | "REJECT",
    responseNote?: string,
  ): Promise<ServiceResult<void>> {
    if (action === "REJECT" && (!responseNote || responseNote.length < 10)) {
      return {
        ok: false,
        error:
          "Please provide a reason for rejecting (at least 10 characters).",
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

  // ── requestPartialRefund ──────────────────────────────────────────────

  async requestPartialRefund(
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

    const interaction = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.PARTIAL_REFUND_REQUEST,
      initiatedById: userId,
      initiatorRole: initiatorRole as "BUYER" | "SELLER",
      reason,
      details: { requestedAmount: amountCents, currency: "NZD" },
      expiresAt,
      autoAction: AUTO_ACTIONS.AUTO_ESCALATE,
    });

    const label = isBuyer ? "Buyer" : "Seller";
    // Fire-and-forget: createInteraction() writes the interaction row without
    // exposing a tx handle — same constraint as requestReturn/requestCancellation.
    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.PARTIAL_REFUND_REQUESTED,
      actorId: userId,
      actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `${label} requested a partial refund of $${amount.toFixed(2)}: ${reason}`,
      metadata: {
        interactionId: interaction.id,
        requestedAmount: amountCents,
      },
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

  // ── respondToPartialRefund ────────────────────────────────────────────

  async respondToPartialRefund(
    userId: string,
    interactionId: string,
    action: "ACCEPT" | "REJECT" | "COUNTER",
    responseNote?: string,
    counterAmount?: number,
  ): Promise<ServiceResult<void>> {
    if (action === "REJECT" && (!responseNote || responseNote.length < 10)) {
      return {
        ok: false,
        error:
          "Please provide a reason for rejecting (at least 10 characters).",
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
      // before the ACCEPT/COUNTER/REJECT branch. The two writes are non-adjacent;
      // atomising them would require restructuring the control flow — out of scope.
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

  // ── notifyShippingDelay ───────────────────────────────────────────────

  async notifyShippingDelay(
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
    if (
      order.status !== "PAYMENT_HELD" &&
      order.status !== "AWAITING_PAYMENT"
    ) {
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

  // ── respondToShippingDelay ────────────────────────────────────────────

  async respondToShippingDelay(
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

  // ── getOrderInteractions ──────────────────────────────────────────────

  async getOrderInteractions(
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
}

export const interactionWorkflowService = new InteractionWorkflowService();
