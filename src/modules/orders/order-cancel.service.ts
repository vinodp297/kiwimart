// src/modules/orders/order-cancel.service.ts
// ─── Order cancellation and cancellation window logic ─────────────────────────
// Exports: CancellationStatus, cancelOrder, getCancellationStatus

import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { audit } from "@/server/lib/audit";
import { transitionOrder } from "./order.transitions";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import { sendCancellationEmail } from "@/server/email";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "./order-event.service";
import { orderRepository } from "./order.repository";

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
  });

  audit({
    userId,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: orderId,
    metadata: {
      newStatus: "CANCELLED",
      cancelledBy: order.buyerId === userId ? "BUYER" : "SELLER",
      reason,
    },
  });

  const cancelledBy = order.buyerId === userId ? "BUYER" : "SELLER";
  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.CANCELLED,
    actorId: userId,
    actorRole: cancelledBy === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
    summary: `${cancelledBy === "BUYER" ? "Buyer" : "Seller"} cancelled order${reason ? `: ${reason}` : ""}`,
    metadata: { cancelledBy, reason },
  });

  logger.info("order.cancelled", { orderId, cancelledBy: userId, reason });

  // Fire-and-forget cancellation emails to both parties
  orderRepository
    .findByIdForCancellationEmail(orderId)
    .then((o) => {
      if (!o) return;
      const refundAmount = order.status === "PAYMENT_HELD" ? o.totalNzd : null;
      const cancelReason = reason ?? "";
      sendCancellationEmail({
        to: o.buyer.email,
        recipientName: o.buyer.displayName ?? "there",
        recipientRole: "buyer",
        orderId,
        listingTitle: o.listing.title,
        cancellationReason: cancelReason,
        refundAmount,
      }).catch(() => {});
      sendCancellationEmail({
        to: o.seller.email,
        recipientName: o.seller.displayName ?? "there",
        recipientRole: "seller",
        orderId,
        listingTitle: o.listing.title,
        cancellationReason: cancelReason,
        refundAmount: null,
      }).catch(() => {});
    })
    .catch(() => {});
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
