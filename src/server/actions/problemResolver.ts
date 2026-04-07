"use server";
// src/server/actions/problemResolver.ts
// ─── Unified Problem Submission ────────────────────────────────────────────
// Single server action for the ProblemResolver component.
// Routes to the appropriate handler based on problem type.

import { safeActionError } from "@/shared/errors";
import { requireUser } from "@/server/lib/requireUser";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { headers } from "next/headers";
import { orderRepository } from "@/modules/orders/order.repository";
import { logger } from "@/shared/logger";
import { orderService } from "@/modules/orders/order.service";
import {
  orderInteractionService,
  INTERACTION_TYPES,
  AUTO_ACTIONS,
} from "@/modules/orders/order-interaction.service";
import { createNotification } from "@/modules/notifications/notification.service";
import { autoResolutionService } from "@/modules/disputes/auto-resolution.service";
import type { ActionResult } from "@/types";
import { submitProblemSchema } from "@/server/validators";

export async function submitProblem(raw: unknown): Promise<
  ActionResult<{
    action: string;
    interactionId?: string;
    autoResolutionQueued?: boolean;
  }>
> {
  try {
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders as unknown as Headers);
    const user = await requireUser();

    const limit = await rateLimit("disputes", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many requests. Please try again later.",
      };
    }

    const parsed = submitProblemSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Please check your input.",
      };
    }

    const { orderId, problemType, description, evidenceKeys, refundAmount } =
      parsed.data;

    const order = await orderRepository.findForProblemResolver(orderId);

    if (!order) return { success: false, error: "Order not found." };
    if (order.buyerId !== user.id) {
      return { success: false, error: "Only the buyer can report a problem." };
    }

    // ── Route by problem type ──────────────────────────────────────

    // CANCEL — route to cancellation flow
    if (problemType === "CANCEL") {
      if (
        order.status !== "PAYMENT_HELD" &&
        order.status !== "AWAITING_PAYMENT"
      ) {
        return {
          success: false,
          error:
            "This order can no longer be cancelled. You can report a different issue.",
        };
      }

      // Check if within free cancellation window (2h)
      const hoursSince =
        (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 2 && order.status === "PAYMENT_HELD") {
        await orderService.cancelOrder(orderId, user.id, description);
        return {
          success: true,
          data: { action: "CANCELLED_FREE_WINDOW" },
        };
      }

      // Outside window — create interaction
      const interaction = await orderInteractionService.createInteraction({
        orderId,
        type: INTERACTION_TYPES.CANCEL_REQUEST,
        initiatedById: user.id,
        initiatorRole: "BUYER",
        reason: description,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        autoAction: AUTO_ACTIONS.AUTO_APPROVE,
      });

      createNotification({
        userId: order.sellerId,
        type: "SYSTEM",
        title: "Cancellation requested",
        body: `The buyer has requested to cancel "${order.listing.title}". You have 48 hours to respond.`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

      return {
        success: true,
        data: { action: "CANCEL_REQUESTED", interactionId: interaction.id },
      };
    }

    // SELLER_NOT_SHIPPING — check how long, reassure or create interaction
    if (problemType === "SELLER_NOT_SHIPPING") {
      if (order.status !== "PAYMENT_HELD") {
        return {
          success: false,
          error: "The order has already been dispatched.",
        };
      }

      const daysSinceOrder = Math.floor(
        (Date.now() - new Date(order.createdAt).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      if (daysSinceOrder < 3) {
        // Within expected dispatch window — just reassure
        return {
          success: true,
          data: { action: "REASSURED_WITHIN_WINDOW" },
        };
      }

      // Overdue — create shipping delay issue
      const interaction = await orderInteractionService.createInteraction({
        orderId,
        type: INTERACTION_TYPES.SHIPPING_DELAY,
        initiatedById: user.id,
        initiatorRole: "BUYER",
        reason: description,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        autoAction: AUTO_ACTIONS.AUTO_ESCALATE,
      });

      createNotification({
        userId: order.sellerId,
        type: "ORDER_DISPUTED",
        title: "Buyer reports shipping delay",
        body: `The buyer is asking about dispatch for "${order.listing.title}". Please dispatch soon or respond.`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

      return {
        success: true,
        data: {
          action: "SHIPPING_DELAY_REPORTED",
          interactionId: interaction.id,
        },
      };
    }

    // NOT_RECEIVED — check if dispatched
    if (problemType === "NOT_RECEIVED") {
      if (order.status !== "DISPATCHED" && order.status !== "DELIVERED") {
        return {
          success: false,
          error: "Please wait until the order has been dispatched.",
        };
      }
    }

    // CHANGED_MIND — route to return request
    if (problemType === "CHANGED_MIND") {
      if (order.status !== "COMPLETED" && order.status !== "DELIVERED") {
        return {
          success: false,
          error:
            "Returns can only be requested for delivered or completed orders.",
        };
      }

      const interaction = await orderInteractionService.createInteraction({
        orderId,
        type: INTERACTION_TYPES.RETURN_REQUEST,
        initiatedById: user.id,
        initiatorRole: "BUYER",
        reason: description,
        details: {
          returnReason: "changed_mind",
          preferredResolution: "full_refund",
        },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        autoAction: AUTO_ACTIONS.AUTO_ESCALATE,
      });

      createNotification({
        userId: order.sellerId,
        type: "SYSTEM",
        title: "Return requested",
        body: `The buyer has requested a return for "${order.listing.title}". You have 72 hours to respond.`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

      return {
        success: true,
        data: { action: "RETURN_REQUESTED", interactionId: interaction.id },
      };
    }

    // PARTIAL_REFUND
    if (problemType === "PARTIAL_REFUND") {
      if (order.status !== "COMPLETED" && order.status !== "DELIVERED") {
        return {
          success: false,
          error:
            "Partial refunds are only available for delivered or completed orders.",
        };
      }
      if (!refundAmount || refundAmount <= 0) {
        return { success: false, error: "Please specify a refund amount." };
      }
      const amountCents = Math.round(refundAmount * 100);
      if (amountCents > order.totalNzd) {
        return {
          success: false,
          error: `Amount cannot exceed $${(order.totalNzd / 100).toFixed(2)}.`,
        };
      }

      const interaction = await orderInteractionService.createInteraction({
        orderId,
        type: INTERACTION_TYPES.PARTIAL_REFUND_REQUEST,
        initiatedById: user.id,
        initiatorRole: "BUYER",
        reason: description,
        details: { requestedAmount: amountCents, currency: "NZD" },
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        autoAction: AUTO_ACTIONS.AUTO_ESCALATE,
      });

      createNotification({
        userId: order.sellerId,
        type: "SYSTEM",
        title: "Partial refund requested",
        body: `The buyer requested a $${refundAmount.toFixed(2)} partial refund for "${order.listing.title}".`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

      return {
        success: true,
        data: {
          action: "PARTIAL_REFUND_REQUESTED",
          interactionId: interaction.id,
        },
      };
    }

    // ── Damage / Wrong item / Not as described / Missing parts / Not received ──
    // These create a dispute with auto-resolution
    if (order.dispute?.openedAt) {
      return {
        success: false,
        error: "A dispute has already been opened for this order.",
      };
    }

    const disputeReasonMap: Record<string, string> = {
      ITEM_DAMAGED: "ITEM_DAMAGED",
      NOT_AS_DESCRIBED: "ITEM_NOT_AS_DESCRIBED",
      WRONG_ITEM: "WRONG_ITEM_SENT",
      MISSING_PARTS: "ITEM_NOT_AS_DESCRIBED",
      NOT_RECEIVED: "ITEM_NOT_RECEIVED",
    };

    const reason = disputeReasonMap[problemType] ?? "OTHER";

    try {
      await orderService.openDispute(
        {
          orderId,
          reason: reason as
            | "ITEM_DAMAGED"
            | "ITEM_NOT_AS_DESCRIBED"
            | "WRONG_ITEM_SENT"
            | "ITEM_NOT_RECEIVED"
            | "OTHER",
          description,
          evidenceUrls: evidenceKeys,
        },
        user.id,
        ip,
      );

      // Queue auto-resolution
      let autoResolutionQueued = false;
      try {
        const evaluation =
          await autoResolutionService.queueAutoResolution(orderId);
        autoResolutionQueued = evaluation.canAutoResolve;
      } catch (err) {
        logger.error("problem.auto_resolution.failed", {
          orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return {
        success: true,
        data: {
          action: "DISPUTE_OPENED",
          autoResolutionQueued,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: safeActionError(err, "We couldn't submit your report."),
      };
    }
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Something went wrong. Please try again."),
    };
  }
}
