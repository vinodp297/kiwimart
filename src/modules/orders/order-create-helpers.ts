// src/modules/orders/order-create-helpers.ts
// ─── Private helpers for order creation ──────────────────────────────────────
// Module-level functions extracted from OrderService private methods.
// Not exported from the barrel — consumed only by order-create.service.ts.

import { audit } from "@/server/lib/audit";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendOrderConfirmationEmail } from "@/server/email";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "./order-event.service";
import { orderRepository } from "./order.repository";
import { pickupQueue } from "@/lib/queue";

// ── handleCashOnPickup ────────────────────────────────────────────────────────

export function handleCashOnPickup(
  orderId: string,
  userId: string,
  listing: { id: string; title: string; sellerId: string },
  totalNzd: number,
  ip: string,
) {
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

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.ORDER_CREATED,
    actorId: userId,
    actorRole: ACTOR_ROLES.BUYER,
    summary: `Cash-on-pickup order placed for "${listing.title}" — $${(totalNzd / 100).toFixed(2)} NZD`,
    metadata: {
      listingId: listing.id,
      totalNzd,
      fulfillmentType: "CASH_ON_PICKUP",
    },
  });

  createNotification({
    userId,
    type: "ORDER_PLACED",
    title: "Order placed",
    body: "Order placed. Now arrange a pickup time with the seller.",
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  createNotification({
    userId: listing.sellerId,
    type: "ORDER_PLACED",
    title: "New pickup order received!",
    body: `New cash-on-pickup order for "${listing.title}". Arrange a pickup time with the buyer.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

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
  orderRepository
    .findBuyerDisplayName(userId)
    .then((buyerRecord) => {
      const buyerName =
        buyerRecord?.displayName ?? userEmail.split("@")[0] ?? "Buyer";

      if (fulfillmentType === "ONLINE_PAYMENT_PICKUP") {
        createNotification({
          userId,
          type: "ORDER_PLACED",
          title: "Order placed",
          body: "Order placed. Now arrange a pickup time with the seller.",
          orderId,
          link: `/orders/${orderId}`,
        }).catch(() => {});
        createNotification({
          userId: listing.sellerId,
          type: "ORDER_PLACED",
          title: "New pickup order received!",
          body: `${buyerName} placed a pickup order for "${listing.title}". Agree a pickup time within 24 hours.`,
          orderId,
          link: `/orders/${orderId}`,
        }).catch(() => {});
      } else {
        createNotification({
          userId: listing.sellerId,
          type: "ORDER_PLACED",
          title: "New order received! 🎉",
          body: `${buyerName} purchased "${listing.title}" for $${(totalNzd / 100).toFixed(2)} NZD`,
          listingId: listing.id,
          orderId,
          link: "/dashboard/seller?tab=orders",
        }).catch(() => {});
      }

      sendOrderConfirmationEmail({
        to: userEmail,
        buyerName,
        sellerName: listing.seller.displayName ?? "the seller",
        listingTitle: listing.title,
        totalNzd,
        orderId,
        listingId: listing.id,
      }).catch(() => {});
    })
    .catch(() => {});
}

// ── schedulePickupDeadline ────────────────────────────────────────────────────

export function schedulePickupDeadline(orderId: string) {
  const deadlineJobId = `pickup-deadline-${orderId}`;
  pickupQueue
    .add(
      "PICKUP_JOB",
      { type: "PICKUP_SCHEDULE_DEADLINE" as const, orderId },
      { delay: 48 * 60 * 60 * 1000, jobId: deadlineJobId },
    )
    .then(() => {
      orderRepository
        .updateScheduleDeadlineJobId(orderId, deadlineJobId)
        .catch(() => {});
    })
    .catch(() => {});
}
