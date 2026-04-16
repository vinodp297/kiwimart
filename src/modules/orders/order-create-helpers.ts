// src/modules/orders/order-create-helpers.ts
// ─── Private helpers for order creation ──────────────────────────────────────
// Module-level functions extracted from OrderService private methods.
// Not exported from the barrel — consumed only by order-create.service.ts.

import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { formatCentsAsNzd } from "@/lib/currency";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendOrderConfirmationEmail } from "@/server/email";
import { fireAndForget } from "@/lib/fire-and-forget";
import { MS_PER_HOUR } from "@/lib/time";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "./order-event.service";
import { orderRepository } from "./order.repository";
import { pickupQueue } from "@/lib/queue";
import { getRequestContext } from "@/lib/request-context";

// ── handleCashOnPickup ────────────────────────────────────────────────────────

export async function handleCashOnPickup(
  orderId: string,
  userId: string,
  listing: { id: string; title: string; sellerId: string },
  totalNzd: number,
  ip: string,
): Promise<void> {
  audit({
    userId,
    action: "ORDER_CREATED",
    entityType: "Order",
    entityId: orderId,
    metadata: {
      listingId: listing.id,
      totalNzd,
      fulfillmentType: "CASH_ON_PICKUP",
    },
    ip,
  });

  // Awaited so the audit event is written before control returns.
  // Errors are caught and logged — a failed write never blocks order creation.
  try {
    await orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.ORDER_CREATED,
      actorId: userId,
      actorRole: ACTOR_ROLES.BUYER,
      summary: `Cash-on-pickup order placed for "${listing.title}" — ${formatCentsAsNzd(totalNzd)}`,
      metadata: {
        listingId: listing.id,
        totalNzd,
        fulfillmentType: "CASH_ON_PICKUP",
      },
    });
  } catch (err: unknown) {
    logger.error("order.cash_pickup.event_write_failed", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  fireAndForget(
    createNotification({
      userId,
      type: "ORDER_PLACED",
      title: "Order placed",
      body: "Order placed. Now arrange a pickup time with the seller.",
      orderId,
      link: `/orders/${orderId}`,
    }),
    "order.notification.buyer.pickup_placed",
    { orderId, userId },
  );

  fireAndForget(
    createNotification({
      userId: listing.sellerId,
      type: "ORDER_PLACED",
      title: "New pickup order received!",
      body: `New cash-on-pickup order for "${listing.title}". Arrange a pickup time with the buyer.`,
      orderId,
      link: `/orders/${orderId}`,
    }),
    "order.notification.seller.pickup_received",
    { orderId, sellerId: listing.sellerId },
  );

  schedulePickupDeadline(orderId);
}

// ── notifyOrderCreated ────────────────────────────────────────────────────────

export function notifyOrderCreated(
  orderId: string,
  userId: string,
  userEmail: string,
  listing: {
    id: string;
    title: string;
    sellerId: string;
    seller: { displayName: string | null };
  },
  totalNzd: number,
  fulfillmentType: string,
) {
  fireAndForget(
    orderRepository.findBuyerDisplayName(userId).then((buyerRecord) => {
      const buyerName =
        buyerRecord?.displayName ?? userEmail.split("@")[0] ?? "Buyer";

      if (fulfillmentType === "ONLINE_PAYMENT_PICKUP") {
        fireAndForget(
          createNotification({
            userId,
            type: "ORDER_PLACED",
            title: "Order placed",
            body: "Order placed. Now arrange a pickup time with the seller.",
            orderId,
            link: `/orders/${orderId}`,
          }),
          "order.notification.buyer.pickup_placed",
          { orderId, userId },
        );
        fireAndForget(
          createNotification({
            userId: listing.sellerId,
            type: "ORDER_PLACED",
            title: "New pickup order received!",
            body: `${buyerName} placed a pickup order for "${listing.title}". Agree a pickup time within 24 hours.`,
            orderId,
            link: `/orders/${orderId}`,
          }),
          "order.notification.seller.pickup_received",
          { orderId, sellerId: listing.sellerId },
        );
      } else {
        fireAndForget(
          createNotification({
            userId: listing.sellerId,
            type: "ORDER_PLACED",
            title: "New order received! 🎉",
            body: `${buyerName} purchased "${listing.title}" for ${formatCentsAsNzd(totalNzd)}`,
            listingId: listing.id,
            orderId,
            link: "/dashboard/seller?tab=orders",
          }),
          "order.notification.seller.order_received",
          { orderId, sellerId: listing.sellerId },
        );
      }

      fireAndForget(
        sendOrderConfirmationEmail({
          to: userEmail,
          buyerName,
          sellerName: listing.seller.displayName ?? "the seller",
          listingTitle: listing.title,
          totalNzd,
          orderId,
          listingId: listing.id,
        }),
        "order.confirmation_email.buyer",
        { orderId, userId },
      );
    }),
    "order.notify_created.lookup",
    { orderId, userId },
  );
}

// ── schedulePickupDeadline ────────────────────────────────────────────────────

export function schedulePickupDeadline(orderId: string) {
  const deadlineJobId = `pickup-deadline-${orderId}`;
  fireAndForget(
    pickupQueue
      .add(
        "PICKUP_JOB",
        {
          type: "PICKUP_SCHEDULE_DEADLINE" as const,
          orderId,
          correlationId: getRequestContext()?.correlationId,
        },
        { delay: 48 * MS_PER_HOUR, jobId: deadlineJobId },
      )
      .then(() => {
        fireAndForget(
          orderRepository.updateScheduleDeadlineJobId(orderId, deadlineJobId),
          "order.pickup.update_deadline_job_id",
          { orderId, deadlineJobId },
        );
      }),
    "order.pickup.schedule_deadline",
    { orderId },
  );
}
