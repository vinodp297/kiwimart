"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/interactions.ts
// ─── Order Interaction Server Actions ───────────────────────────────────────
// Cancellation requests, returns, partial refunds — all negotiation workflows.

import { requireUser } from "@/server/lib/requireUser";
import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { orderService } from "@/modules/orders/order.service";
import { paymentService } from "@/modules/payments/payment.service";
import {
  orderInteractionService,
  INTERACTION_TYPES,
  AUTO_ACTIONS,
} from "@/modules/orders/order-interaction.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { createNotification } from "@/modules/notifications/notification.service";
import type { ActionResult } from "@/types";
import { z } from "zod";

// ── Schemas ─────────────────────────────────────────────────────────────────

const requestCancellationSchema = z.object({
  orderId: z.string().min(1),
  reason: z
    .string()
    .min(10, "Please provide a reason (at least 10 characters).")
    .max(500)
    .trim(),
});

const respondToCancellationSchema = z.object({
  interactionId: z.string().min(1),
  action: z.enum(["ACCEPT", "REJECT"]),
  responseNote: z.string().max(500).trim().optional(),
});

// ── Free cancellation window ────────────────────────────────────────────────
const FREE_CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── requestCancellation ─────────────────────────────────────────────────────

export async function requestCancellation(
  raw: unknown,
): Promise<ActionResult<{ autoApproved: boolean; interactionId?: string }>> {
  try {
    const user = await requireUser();

    const parsed = requestCancellationSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { orderId, reason } = parsed.data;

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        createdAt: true,
        stripePaymentIntentId: true,
        listing: { select: { title: true } },
      },
    });

    if (!order) {
      return { success: false, error: "Order not found." };
    }

    // Must be buyer or seller
    const isBuyer = order.buyerId === user.id;
    const isSeller = order.sellerId === user.id;
    if (!isBuyer && !isSeller) {
      return { success: false, error: "You are not a party to this order." };
    }

    // Only allow cancellation for pre-dispatch statuses
    if (
      order.status !== "AWAITING_PAYMENT" &&
      order.status !== "PAYMENT_HELD"
    ) {
      return {
        success: false,
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
      hoursSinceCreation < 2 && order.status === "PAYMENT_HELD";

    // ── Free cancellation window: auto-approve immediately ────────────────
    if (isInFreeWindow) {
      // Cancel the order
      await orderService.cancelOrder(orderId, user.id, reason);

      // Refund if payment was held
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
          // Order is already cancelled — admin can retry refund manually
        }
      }

      orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.CANCEL_REQUESTED,
        actorId: user.id,
        actorRole: isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
        summary: `${initiatorRole === "BUYER" ? "Buyer" : "Seller"} requested cancellation (free window): ${reason}`,
        metadata: { reason, autoApproved: true },
      });

      orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.CANCEL_AUTO_APPROVED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary:
          "Cancellation auto-approved (within 2-hour free cancellation window)",
      });

      createNotification({
        userId: otherPartyId,
        type: "SYSTEM",
        title: "Order cancelled",
        body: `${initiatorRole === "BUYER" ? "The buyer" : "The seller"} cancelled the order for "${order.listing.title}". A refund has been initiated.`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

      return { success: true, data: { autoApproved: true } };
    }

    // ── Outside free window: create interaction for seller to respond ──────
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    const interaction = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.CANCEL_REQUEST,
      initiatedById: user.id,
      initiatorRole: initiatorRole as "BUYER" | "SELLER",
      reason,
      expiresAt,
      autoAction: AUTO_ACTIONS.AUTO_APPROVE,
    });

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.CANCEL_REQUESTED,
      actorId: user.id,
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
      success: true,
      data: { autoApproved: false, interactionId: interaction.id },
    };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your cancellation request. Please try again.",
      ),
    };
  }
}

// ── respondToCancellation ───────────────────────────────────────────────────

export async function respondToCancellation(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const parsed = respondToCancellationSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { interactionId, action, responseNote } = parsed.data;

    if (action === "REJECT" && (!responseNote || responseNote.length < 10)) {
      return {
        success: false,
        error:
          "Please provide a reason for rejecting (at least 10 characters).",
      };
    }

    // Respond to the interaction
    const { interaction } = await orderInteractionService.respondToInteraction(
      interactionId,
      user.id,
      action,
      responseNote,
    );

    const order = await db.order.findUnique({
      where: { id: interaction.orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        stripePaymentIntentId: true,
        listing: { select: { title: true } },
      },
    });

    if (!order) {
      return { success: false, error: "Order not found." };
    }

    const isBuyer = user.id === order.buyerId;
    const responderRole = isBuyer ? "Buyer" : "Seller";

    if (action === "ACCEPT") {
      // Cancel the order
      // Use the initiator's ID so cancelOrder sees them as a valid party
      await orderService.cancelOrder(
        interaction.orderId,
        interaction.initiatedById,
        interaction.reason,
      );

      // Refund if payment was held
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
        actorId: user.id,
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
      // REJECTED
      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.CANCEL_REJECTED,
        actorId: user.id,
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

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your response. Please try again.",
      ),
    };
  }
}

// ─��� requestReturn ───────────────────────────────────────────────────────────

const requestReturnSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(10).max(500).trim(),
  details: z
    .object({
      returnReason: z.enum([
        "damaged",
        "not_as_described",
        "wrong_item",
        "changed_mind",
      ]),
      preferredResolution: z.enum(["full_refund", "replacement", "exchange"]),
    })
    .optional(),
});

export async function requestReturn(
  raw: unknown,
): Promise<ActionResult<{ interactionId: string }>> {
  try {
    const user = await requireUser();
    const parsed = requestReturnSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { orderId, reason, details } = parsed.data;

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        listing: { select: { title: true } },
      },
    });

    if (!order) return { success: false, error: "Order not found." };
    if (order.buyerId !== user.id) {
      return { success: false, error: "Only the buyer can request a return." };
    }
    if (order.status !== "COMPLETED" && order.status !== "DELIVERED") {
      return {
        success: false,
        error:
          "Returns can only be requested for completed or delivered orders.",
      };
    }

    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    const interaction = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.RETURN_REQUEST,
      initiatedById: user.id,
      initiatorRole: "BUYER",
      reason,
      details: details as Record<string, unknown> | undefined,
      expiresAt,
      autoAction: AUTO_ACTIONS.AUTO_ESCALATE,
    });

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.RETURN_REQUESTED,
      actorId: user.id,
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

    return { success: true, data: { interactionId: interaction.id } };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "We couldn't process your return request."),
    };
  }
}

// ── respondToReturn ─────────────────────────────────────────────────────────

const respondToReturnSchema = z.object({
  interactionId: z.string().min(1),
  action: z.enum(["ACCEPT", "REJECT"]),
  responseNote: z.string().max(1000).trim().optional(),
});

export async function respondToReturn(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = respondToReturnSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { interactionId, action, responseNote } = parsed.data;

    if (action === "REJECT" && (!responseNote || responseNote.length < 10)) {
      return {
        success: false,
        error:
          "Please provide a reason for rejecting (at least 10 characters).",
      };
    }

    const { interaction } = await orderInteractionService.respondToInteraction(
      interactionId,
      user.id,
      action,
      responseNote,
    );

    const order = await db.order.findUnique({
      where: { id: interaction.orderId },
      select: {
        listing: { select: { title: true } },
      },
    });

    if (action === "ACCEPT") {
      // Mark resolved — admin/seller provides return instructions in responseNote
      await db.orderInteraction.update({
        where: { id: interactionId },
        data: { resolvedAt: new Date(), resolution: "RETURNED" },
      });

      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.RETURN_APPROVED,
        actorId: user.id,
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
    } else {
      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.RETURN_REJECTED,
        actorId: user.id,
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
    }

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "We couldn't process your response."),
    };
  }
}

// ── requestPartialRefund ────────────────────────────────────────────────────

const requestPartialRefundSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(10).max(500).trim(),
  amount: z.number().positive("Amount must be greater than 0"),
});

export async function requestPartialRefund(
  raw: unknown,
): Promise<ActionResult<{ interactionId: string }>> {
  try {
    const user = await requireUser();
    const parsed = requestPartialRefundSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { orderId, reason, amount } = parsed.data;

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        totalNzd: true,
        listing: { select: { title: true } },
      },
    });

    if (!order) return { success: false, error: "Order not found." };

    const isBuyer = order.buyerId === user.id;
    const isSeller = order.sellerId === user.id;
    if (!isBuyer && !isSeller) {
      return { success: false, error: "You are not a party to this order." };
    }

    if (order.status !== "COMPLETED" && order.status !== "DELIVERED") {
      return {
        success: false,
        error:
          "Partial refunds can only be requested for completed or delivered orders.",
      };
    }

    // Amount must be <= order total (totalNzd is in cents)
    const amountCents = Math.round(amount * 100);
    if (amountCents > order.totalNzd) {
      return {
        success: false,
        error: `Amount cannot exceed the order total of $${(order.totalNzd / 100).toFixed(2)}.`,
      };
    }

    const initiatorRole = isBuyer ? "BUYER" : "SELLER";
    const otherPartyId = isBuyer ? order.sellerId : order.buyerId;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    const interaction = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.PARTIAL_REFUND_REQUEST,
      initiatedById: user.id,
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
      actorId: user.id,
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

    return { success: true, data: { interactionId: interaction.id } };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your partial refund request.",
      ),
    };
  }
}

// ── respondToPartialRefund ──────────────────────────────────────────────────

const respondToPartialRefundSchema = z.object({
  interactionId: z.string().min(1),
  action: z.enum(["ACCEPT", "REJECT", "COUNTER"]),
  responseNote: z.string().max(500).trim().optional(),
  counterAmount: z.number().positive().optional(),
});

export async function respondToPartialRefund(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = respondToPartialRefundSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { interactionId, action, responseNote, counterAmount } = parsed.data;

    if (action === "REJECT" && (!responseNote || responseNote.length < 10)) {
      return {
        success: false,
        error:
          "Please provide a reason for rejecting (at least 10 characters).",
      };
    }
    if (action === "COUNTER" && !counterAmount) {
      return {
        success: false,
        error: "Please provide a counter-offer amount.",
      };
    }

    // For COUNTER, we use the service but with a special action mapping
    const serviceAction = action === "COUNTER" ? "REJECT" : action;
    const { interaction } = await orderInteractionService.respondToInteraction(
      interactionId,
      user.id,
      serviceAction as "ACCEPT" | "REJECT",
      responseNote,
    );

    // For COUNTER, override the status to COUNTERED
    if (action === "COUNTER") {
      const counterCents = Math.round(counterAmount! * 100);
      await db.orderInteraction.update({
        where: { id: interactionId },
        data: {
          status: "COUNTERED",
          details: {
            ...(interaction.details as Record<string, unknown> | null),
            counterAmount: counterCents,
            counterCurrency: "NZD",
          },
        },
      });
    }

    const order = await db.order.findUnique({
      where: { id: interaction.orderId },
      select: { listing: { select: { title: true } } },
    });

    const isBuyer =
      user.id ===
      (
        await db.order.findUnique({
          where: { id: interaction.orderId },
          select: { buyerId: true },
        })
      )?.buyerId;
    const responderRole = isBuyer ? "Buyer" : "Seller";

    if (action === "ACCEPT") {
      await db.orderInteraction.update({
        where: { id: interactionId },
        data: { resolvedAt: new Date(), resolution: "PARTIAL_REFUND" },
      });

      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_APPROVED,
        actorId: user.id,
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
        actorId: user.id,
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
      // REJECT
      orderEventService.recordEvent({
        orderId: interaction.orderId,
        type: ORDER_EVENT_TYPES.PARTIAL_REFUND_REQUESTED,
        actorId: user.id,
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

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "We couldn't process your response."),
    };
  }
}

// ── notifyShippingDelay ─────────────────────────────────────────────────────

const notifyShippingDelaySchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(10).max(500).trim(),
  estimatedNewDate: z.string().optional(),
});

export async function notifyShippingDelay(
  raw: unknown,
): Promise<ActionResult<{ interactionId: string }>> {
  try {
    const user = await requireUser();
    const parsed = notifyShippingDelaySchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { orderId, reason, estimatedNewDate } = parsed.data;

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        listing: { select: { title: true } },
      },
    });

    if (!order) return { success: false, error: "Order not found." };
    if (order.sellerId !== user.id) {
      return {
        success: false,
        error: "Only the seller can notify about shipping delays.",
      };
    }
    if (
      order.status !== "PAYMENT_HELD" &&
      order.status !== "AWAITING_PAYMENT"
    ) {
      return {
        success: false,
        error:
          "Shipping delay notifications are only applicable before dispatch.",
      };
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const interaction = await orderInteractionService.createInteraction({
      orderId,
      type: INTERACTION_TYPES.SHIPPING_DELAY,
      initiatedById: user.id,
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
      actorId: user.id,
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

    return { success: true, data: { interactionId: interaction.id } };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't send the shipping delay notification.",
      ),
    };
  }
}

// ── respondToShippingDelay ──────────────────────────────────────────────────

const respondToShippingDelaySchema = z.object({
  interactionId: z.string().min(1),
  action: z.enum(["ACCEPT", "REJECT"]),
  responseNote: z.string().max(500).trim().optional(),
});

export async function respondToShippingDelay(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = respondToShippingDelaySchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { interactionId, action, responseNote } = parsed.data;

    const { interaction } = await orderInteractionService.respondToInteraction(
      interactionId,
      user.id,
      action,
      responseNote,
    );

    // ACCEPT = acknowledged, REJECT = buyer not happy (can request cancellation)
    if (action === "ACCEPT") {
      await db.orderInteraction.update({
        where: { id: interactionId },
        data: { resolvedAt: new Date(), resolution: "DISMISSED" },
      });
    }

    const order = await db.order.findUnique({
      where: { id: interaction.orderId },
      select: { listing: { select: { title: true } } },
    });

    orderEventService.recordEvent({
      orderId: interaction.orderId,
      type: ORDER_EVENT_TYPES.SHIPPING_DELAY_NOTIFIED,
      actorId: user.id,
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

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "We couldn't process your response."),
    };
  }
}

// ── getOrderInteractions ────────────────────────────────────────────────────

export interface InteractionData {
  id: string;
  type: string;
  status: string;
  initiatorRole: string;
  reason: string;
  details: Record<string, unknown> | null;
  responseNote: string | null;
  expiresAt: string;
  autoAction: string;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
  initiator: { id: string; displayName: string | null; username: string };
  responder: {
    id: string;
    displayName: string | null;
    username: string;
  } | null;
}

export async function getOrderInteractions(
  orderId: string,
): Promise<ActionResult<InteractionData[]>> {
  try {
    const user = await requireUser();

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, sellerId: true },
    });

    if (!order) {
      return { success: false, error: "Order not found." };
    }

    const isParty =
      order.buyerId === user.id || order.sellerId === user.id || user.isAdmin;

    if (!isParty) {
      return {
        success: false,
        error: "You do not have access to this order.",
      };
    }

    const interactions =
      await orderInteractionService.getInteractionsByOrder(orderId);

    return {
      success: true,
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
  } catch {
    return {
      success: false,
      error: "Could not load order interactions.",
    };
  }
}
