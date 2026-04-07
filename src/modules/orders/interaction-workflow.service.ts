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
import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { interactionRepository } from "./interaction.repository";

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

    const order = await interactionRepository.findOrderForCancellation(orderId);
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
      (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60);
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

      createNotification({
        userId: otherPartyId,
        type: "SYSTEM",
        title: "Order cancelled",
        body: `${initiatorRole === "BUYER" ? "The buyer" : "The seller"} cancelled the order for "${order.listing.title}". A refund has been initiated.`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

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
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const interaction = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.CANCEL_REQUEST,
      initiatedById: userId,
      initiatorRole: initiatorRole as "BUYER" | "SELLER",
      reason,
      expiresAt,
      autoAction: AUTO_ACTIONS.AUTO_APPROVE,
    });

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

    createNotification({
      userId: otherPartyId,
      type: "SYSTEM",
      title: "Cancellation requested",
      body: `${initiatorRole === "BUYER" ? "The buyer" : "The seller"} has requested to cancel the order for "${order.listing.title}". You have 48 hours to respond.`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

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

    const order = await interactionRepository.findOrderAfterResponse(
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

      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.CANCEL_APPROVED,
        actorId: userId,
        actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
        summary: `${responderRole} approved the cancellation request`,
        metadata: { interactionId },
      });

      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Cancellation approved",
        body: `Your cancellation request for "${order.listing.title}" has been approved. A refund has been initiated.`,
        orderId: order.id,
        link: `/orders/${order.id}`,
      }).catch(() => {});
    } else {
      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.CANCEL_REJECTED,
        actorId: userId,
        actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
        summary: `${responderRole} rejected the cancellation request${responseNote ? `: ${responseNote}` : ""}`,
        metadata: { interactionId, responseNote },
      });

      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Cancellation rejected",
        body: `Your cancellation request for "${order.listing.title}" was declined. You can open a dispute if you believe this is unfair.`,
        orderId: order.id,
        link: `/orders/${order.id}`,
      }).catch(() => {});
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
    const order = await interactionRepository.findOrderForReturn(orderId);
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
    const expiresAt = new Date(
      Date.now() + returnResponseHours * 60 * 60 * 1000,
    );

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

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.RETURN_REQUESTED,
      actorId: userId,
      actorRole: ACTOR_ROLES.BUYER,
      summary: `Buyer requested a return: ${reason}`,
      metadata: { interactionId: interaction.id, ...details },
    });

    createNotification({
      userId: order.sellerId,
      type: "SYSTEM",
      title: "Return requested",
      body: `The buyer has requested a return for "${order.listing.title}". You have 72 hours to respond.`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    // Fire-and-forget return request email to seller
    interactionRepository
      .findUserEmailInfo(order.sellerId)
      .then((seller) => {
        if (!seller) return;
        sendReturnRequestEmail({
          to: seller.email,
          recipientName: seller.displayName ?? "there",
          recipientRole: "seller",
          orderId,
          listingTitle: order.listing.title,
          action: "REQUESTED",
          reason: reason ?? null,
          sellerNote: null,
        }).catch(() => {});
      })
      .catch(() => {});

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

    const order = await interactionRepository.findOrderListingTitle(
      interaction.orderId,
    );

    if (action === "ACCEPT") {
      await interactionRepository.updateInteractionResolution(
        interactionId,
        "RETURNED",
      );

      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.RETURN_APPROVED,
        actorId: userId,
        actorRole: ACTOR_ROLES.SELLER,
        summary: `Seller approved the return request${responseNote ? `: ${responseNote}` : ""}`,
        metadata: { interactionId },
      });

      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Return approved",
        body: `Your return request for "${order?.listing.title}" has been approved. Check the order for return instructions.`,
        orderId: interaction.orderId,
        link: `/orders/${interaction.orderId}`,
      }).catch(() => {});

      // Fire-and-forget return approved email to buyer
      interactionRepository
        .findUserEmailInfo(interaction.initiatedById)
        .then((buyer) => {
          if (!buyer) return;
          sendReturnRequestEmail({
            to: buyer.email,
            recipientName: buyer.displayName ?? "there",
            recipientRole: "buyer",
            orderId: interaction.orderId,
            listingTitle: order?.listing.title ?? "your item",
            action: "APPROVED",
            reason: null,
            sellerNote: responseNote ?? null,
          }).catch(() => {});
        })
        .catch(() => {});
    } else {
      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.RETURN_REJECTED,
        actorId: userId,
        actorRole: ACTOR_ROLES.SELLER,
        summary: `Seller rejected the return request${responseNote ? `: ${responseNote}` : ""}`,
        metadata: { interactionId, responseNote },
      });

      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Return rejected",
        body: `Your return request for "${order?.listing.title}" was declined. You can open a dispute if you believe this is unfair.`,
        orderId: interaction.orderId,
        link: `/orders/${interaction.orderId}`,
      }).catch(() => {});

      // Fire-and-forget return rejected email to buyer
      interactionRepository
        .findUserEmailInfo(interaction.initiatedById)
        .then((buyer) => {
          if (!buyer) return;
          sendReturnRequestEmail({
            to: buyer.email,
            recipientName: buyer.displayName ?? "there",
            recipientRole: "buyer",
            orderId: interaction.orderId,
            listingTitle: order?.listing.title ?? "your item",
            action: "REJECTED",
            reason: null,
            sellerNote: responseNote ?? null,
          }).catch(() => {});
        })
        .catch(() => {});
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
    const order =
      await interactionRepository.findOrderForPartialRefund(orderId);
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

    const amountCents = Math.round(amount * 100);
    if (amountCents > order.totalNzd) {
      return {
        ok: false,
        error: `Amount cannot exceed the order total of $${(order.totalNzd / 100).toFixed(2)}.`,
      };
    }

    const initiatorRole = isBuyer ? "BUYER" : "SELLER";
    const otherPartyId = isBuyer ? order.sellerId : order.buyerId;
    const partialRefundResponseHours = await getConfigInt(
      CONFIG_KEYS.PARTIAL_REFUND_RESPONSE_HOURS,
    );
    const expiresAt = new Date(
      Date.now() + partialRefundResponseHours * 60 * 60 * 1000,
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

    createNotification({
      userId: otherPartyId,
      type: "SYSTEM",
      title: "Partial refund requested",
      body: `${label} has requested a partial refund of $${amount.toFixed(2)} for "${order.listing.title}". You have 48 hours to respond.`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

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
      const counterCents = Math.round(counterAmount! * 100);
      await interactionRepository.updateInteractionCounter(interactionId, {
        ...(interaction.details as Record<string, unknown> | null),
        counterAmount: counterCents,
        counterCurrency: "NZD",
      } as import("@prisma/client").Prisma.InputJsonValue);
    }

    const order = await interactionRepository.findOrderListingTitle(
      interaction.orderId,
    );
    const parties = await interactionRepository.findOrderBuyerId(
      interaction.orderId,
    );

    const isBuyer = userId === parties?.buyerId;
    const responderRole = isBuyer ? "Buyer" : "Seller";

    if (action === "ACCEPT") {
      await interactionRepository.updateInteractionResolution(
        interactionId,
        "PARTIAL_REFUND",
      );

      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_APPROVED,
        actorId: userId,
        actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
        summary: `${responderRole} approved the partial refund request`,
        metadata: { interactionId },
      });

      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Partial refund approved",
        body: `Your partial refund request for "${order?.listing.title}" has been approved.`,
        orderId: interaction.orderId,
        link: `/orders/${interaction.orderId}`,
      }).catch(() => {});
    } else if (action === "COUNTER") {
      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_REQUESTED,
        actorId: userId,
        actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
        summary: `${responderRole} counter-offered $${counterAmount!.toFixed(2)} for the partial refund`,
        metadata: {
          interactionId,
          counterAmount: Math.round(counterAmount! * 100),
        },
      });

      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Counter-offer received",
        body: `${responderRole} counter-offered $${counterAmount!.toFixed(2)} on your partial refund request for "${order?.listing.title}".`,
        orderId: interaction.orderId,
        link: `/orders/${interaction.orderId}`,
      }).catch(() => {});
    } else {
      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_REQUESTED,
        actorId: userId,
        actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
        summary: `${responderRole} rejected the partial refund request${responseNote ? `: ${responseNote}` : ""}`,
        metadata: { interactionId, responseNote },
      });

      createNotification({
        userId: interaction.initiatedById,
        type: "SYSTEM",
        title: "Partial refund rejected",
        body: `Your partial refund request for "${order?.listing.title}" was declined.`,
        orderId: interaction.orderId,
        link: `/orders/${interaction.orderId}`,
      }).catch(() => {});
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
    const order = await interactionRepository.findOrderForDelay(orderId);
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
    const expiresAt = new Date(
      Date.now() + shippingDelayDays * 24 * 60 * 60 * 1000,
    );

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

    createNotification({
      userId: order.buyerId,
      type: "SYSTEM",
      title: "Shipping delay",
      body: `The seller has notified a shipping delay for "${order.listing.title}": ${reason}`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

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

    if (action === "ACCEPT") {
      await interactionRepository.updateInteractionResolution(
        interactionId,
        "DISMISSED",
      );
    }

    const order = await interactionRepository.findOrderListingTitle(
      interaction.orderId,
    );

    orderEventService.recordEvent({
      orderId: interaction.orderId,
      type: ORDER_EVENT_TYPES.SHIPPING_DELAY_NOTIFIED,
      actorId: userId,
      actorRole: ACTOR_ROLES.BUYER,
      summary:
        action === "ACCEPT"
          ? "Buyer acknowledged the shipping delay"
          : `Buyer did not accept the shipping delay${responseNote ? `: ${responseNote}` : ""}`,
      metadata: { interactionId, action },
    });

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
    }).catch(() => {});

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
