// src/server/services/pickup/pickup-cancel.service.ts
// ─── Pickup order cancellation ────────────────────────────────────────────────
// Exports: cancelPickupOrder

import { withTransaction } from "@/lib/transaction";
import { logger } from "@/shared/logger";
import { audit } from "@/server/lib/audit";
import { createNotification } from "@/modules/notifications/notification.service";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { paymentService } from "@/modules/payments/payment.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { orderRepository } from "@/modules/orders/order.repository";
import { listingRepository } from "@/modules/listings/listing.repository";
import { pickupRepository } from "@/modules/pickup/pickup.repository";
import { getPickupConfig } from "./pickup-scheduling.helpers";
import { fireAndForget } from "@/lib/fire-and-forget";
import type { PickupResult } from "./pickup-scheduling.types";

// ── cancelPickupOrder ─────────────────────────────────────────────────────────

export async function cancelPickupOrder(params: {
  orderId: string;
  cancelledById: string;
  reason: string;
}): Promise<PickupResult> {
  const { orderId, cancelledById, reason } = params;
  const pickupCfg = await getPickupConfig();

  const order = await orderRepository.findWithPickupContext(orderId);

  if (!order) return { success: false, error: "Order not found." };

  if (order.status !== "AWAITING_PICKUP") {
    return {
      success: false,
      error: "This order cannot be cancelled at this stage.",
    };
  }

  // Cannot cancel once OTP initiated or completed
  if (
    order.pickupStatus === "OTP_INITIATED" ||
    order.pickupStatus === "COMPLETED"
  ) {
    return {
      success: false,
      error: "Pickup is already in progress or completed.",
    };
  }

  // Validate canceller is a party
  if (cancelledById !== order.buyerId && cancelledById !== order.sellerId) {
    return { success: false, error: "You are not a party to this order." };
  }

  // If pickup is SCHEDULED and within 2 hours of pickupScheduledAt,
  // only allow if force-cancel eligible (rescheduleCount >= threshold)
  if (order.pickupStatus === "SCHEDULED" && order.pickupScheduledAt) {
    const hoursUntilPickup =
      (order.pickupScheduledAt.getTime() - Date.now()) / (1000 * 60 * 60);
    if (
      hoursUntilPickup <= 2 &&
      order.rescheduleCount < pickupCfg.FORCE_CANCEL_THRESHOLD
    ) {
      return {
        success: false,
        error:
          "Cannot cancel within 2 hours of scheduled pickup. Please reschedule instead.",
      };
    }
  }

  await withTransaction(async (tx) => {
    await transitionOrder(
      orderId,
      "CANCELLED",
      {
        cancelledBy: cancelledById === order.buyerId ? "BUYER" : "SELLER",
        cancelReason: reason,
        cancelledAt: new Date(),
        pickupStatus: "CANCELLED",
        pickupCancelledAt: new Date(),
        pickupWindowJobId: null,
        scheduleDeadlineJobId: null,
      },
      { tx, fromStatus: order.status },
    );

    // Reactivate listing
    if (order.listingId) {
      await listingRepository.reactivate(order.listingId, tx);
    }

    // Cancel any pending reschedule requests
    await pickupRepository.cancelPendingRescheduleRequests(orderId, tx);
  });

  // Refund buyer if online payment pickup
  if (
    order.fulfillmentType === "ONLINE_PAYMENT_PICKUP" &&
    order.stripePaymentIntentId
  ) {
    try {
      await paymentService.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        orderId,
      });
    } catch (err) {
      logger.error("pickup.cancel.refund_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const cancelledByRole = cancelledById === order.buyerId ? "BUYER" : "SELLER";
  const otherPartyId =
    cancelledById === order.buyerId ? order.sellerId : order.buyerId;

  // Audit
  audit({
    userId: cancelledById,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: orderId,
    metadata: {
      newStatus: "CANCELLED",
      cancelledBy: cancelledByRole,
      reason,
      fulfillmentType: order.fulfillmentType,
    },
  });

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.CANCELLED,
    actorId: cancelledById,
    actorRole:
      cancelledByRole === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
    summary: `${cancelledByRole === "BUYER" ? "Buyer" : "Seller"} cancelled pickup order: ${reason}`,
    metadata: { cancelledBy: cancelledByRole, reason },
  });

  // Notify both parties
  fireAndForget(
    createNotification({
      userId: cancelledById,
      type: "SYSTEM",
      title: "Pickup order cancelled",
      body: `You cancelled the pickup order for "${order.listing.title}".`,
      orderId,
      link: `/orders/${orderId}`,
    }),
    "pickup.cancel.initiatorNotification",
    { orderId },
  );

  fireAndForget(
    createNotification({
      userId: otherPartyId,
      type: "SYSTEM",
      title: "Pickup order cancelled",
      body: `The ${cancelledByRole.toLowerCase()} cancelled the pickup for "${order.listing.title}".${order.fulfillmentType === "ONLINE_PAYMENT_PICKUP" ? " A refund has been initiated." : ""}`,
      orderId,
      link: `/orders/${orderId}`,
    }),
    "pickup.cancel.otherPartyNotification",
    { orderId },
  );

  logger.info("pickup.cancelled", { orderId, cancelledById, reason });

  return { success: true };
}
