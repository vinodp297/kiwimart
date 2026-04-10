// src/modules/orders/order-cancel.service.ts
// ─── Order cancellation and cancellation window logic ─────────────────────────
// Exports: CancellationStatus, cancelOrder, getCancellationStatus

import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { audit } from "@/server/lib/audit";
import { transitionOrder } from "./order.transitions";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import { sendCancellationEmail } from "@/server/email";
import { fireAndForget } from "@/lib/fire-and-forget";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "./order-event.service";
import { orderRepository } from "./order.repository";
import { paymentService } from "@/modules/payments/payment.service";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CancellationStatus {
  canCancel: boolean;
  requiresReason: boolean;
  message: string;
  windowType: "free" | "request" | "closed" | "na";
}

// ── cancelOrder ───────────────────────────────────────────────────────────────

export async function cancelOrder(
  orderId: string,
  userId: string,
  reason?: string,
): Promise<void> {
  const order = await orderRepository.findByIdForCancel(orderId, userId);

  if (!order) throw AppError.notFound("Order");

  const status = await getCancellationStatus(order);
  if (!status.canCancel) {
    throw new AppError("ORDER_WRONG_STATE", status.message, 400);
  }
  if (status.requiresReason && !reason) {
    throw AppError.validation("Please provide a reason for cancellation.");
  }

  // Stripe refund/void BEFORE DB transition — money must move first.
  // If the order has a held payment and the refund fails, transition to
  // DISPUTED for manual review instead of silently cancelling.
  if (order.status === "PAYMENT_HELD" && order.stripePaymentIntentId) {
    try {
      await paymentService.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        orderId: order.id,
        reason: "Order cancelled",
      });
    } catch (err) {
      logger.error("order.cancel.refund_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Refund failed — escalate to DISPUTED for manual review
      await transitionOrder(
        orderId,
        "DISPUTED",
        {
          disputeReason: "Cancellation refund failed — requires manual review",
          disputedAt: new Date(),
        },
        { fromStatus: order.status },
      );

      throw new AppError(
        "PAYMENT_GATEWAY_ERROR",
        "Cancellation refund failed — requires manual review",
        500,
      );
    }
  }

  const cancelledBy = order.buyerId === userId ? "BUYER" : "SELLER";

  await orderRepository.$transaction(async (tx) => {
    await transitionOrder(
      orderId,
      "CANCELLED",
      {
        cancelledBy: order.buyerId === userId ? "BUYER" : "SELLER",
        cancelReason: reason ?? null,
        cancelledAt: new Date(),
      },
      { tx, fromStatus: order.status },
    );

    // Reactivate the listing
    if (order.listingId) {
      await orderRepository.reactivateListingInTx(order.listingId, tx);
    }

    // CRITICAL: audit and event recording inside the transaction so they
    // roll back atomically if the transition or listing update fails.
    await audit({
      userId,
      action: "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: orderId,
      metadata: {
        newStatus: "CANCELLED",
        cancelledBy,
        reason,
      },
      tx,
    });

    await orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.CANCELLED,
      actorId: userId,
      actorRole:
        cancelledBy === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `${cancelledBy === "BUYER" ? "Buyer" : "Seller"} cancelled order${reason ? `: ${reason}` : ""}`,
      metadata: { cancelledBy, reason },
      tx,
    });
  });

  logger.info("order.cancelled", { orderId, cancelledBy: userId, reason });

  // Fire-and-forget cancellation emails to both parties
  fireAndForget(
    orderRepository.findByIdForEmail(orderId).then((o) => {
      if (!o) return;
      const refundAmount = order.status === "PAYMENT_HELD" ? o.totalNzd : null;
      const cancelReason = reason ?? "";
      fireAndForget(
        sendCancellationEmail({
          to: o.buyer.email,
          recipientName: o.buyer.displayName ?? "there",
          recipientRole: "buyer",
          orderId,
          listingTitle: o.listing.title,
          cancellationReason: cancelReason,
          refundAmount,
        }),
        "order.cancellation_email.buyer",
        { orderId },
      );
      fireAndForget(
        sendCancellationEmail({
          to: o.seller.email,
          recipientName: o.seller.displayName ?? "there",
          recipientRole: "seller",
          orderId,
          listingTitle: o.listing.title,
          cancellationReason: cancelReason,
          refundAmount: null,
        }),
        "order.cancellation_email.seller",
        { orderId },
      );
    }),
    "order.cancellation_email.lookup",
    { orderId },
  );
}

// ── getCancellationStatus ─────────────────────────────────────────────────────

export async function getCancellationStatus(order: {
  status: string;
  createdAt: Date;
}): Promise<CancellationStatus> {
  if (order.status !== "PAYMENT_HELD") {
    return {
      canCancel: false,
      requiresReason: false,
      windowType: "na",
      message:
        order.status === "DISPATCHED"
          ? "Order already dispatched. Open a dispute if there is an issue."
          : "This order cannot be cancelled at this stage.",
    };
  }

  const [freeWindowMinutes, requestWindowHours] = await Promise.all([
    getConfigInt(CONFIG_KEYS.FREE_CANCEL_WINDOW_MINUTES),
    getConfigInt(CONFIG_KEYS.CANCEL_REQUEST_WINDOW_HOURS),
  ]);

  const minutesElapsed = Math.floor(
    (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60),
  );

  if (minutesElapsed <= freeWindowMinutes) {
    const minutesLeft = freeWindowMinutes - minutesElapsed;
    return {
      canCancel: true,
      requiresReason: false,
      windowType: "free",
      message: `Free cancellation available for another ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.`,
    };
  }

  if (minutesElapsed <= requestWindowHours * 60) {
    return {
      canCancel: true,
      requiresReason: true,
      windowType: "request",
      message: "Cancellation requires a reason after the first hour.",
    };
  }

  return {
    canCancel: false,
    requiresReason: false,
    windowType: "closed",
    message:
      "Cancellation window has closed. Open a dispute if there is an issue.",
  };
}
