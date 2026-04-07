// src/modules/orders/order-dispatch.service.ts
// ─── Order dispatch and delivery confirmation ─────────────────────────────────
// Exports: DeliveryFeedback, confirmDelivery, markDispatched

import { audit } from "@/server/lib/audit";
import { paymentService } from "@/modules/payments/payment.service";
import { transitionOrder } from "./order.transitions";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import { getRequestContext } from "@/lib/request-context";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendOrderDispatchedEmail } from "@/server/email";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "./order-event.service";
import {
  orderInteractionService,
  INTERACTION_TYPES,
  AUTO_ACTIONS,
} from "./order-interaction.service";
import { orderRepository } from "./order.repository";
import type { DispatchOrderInput } from "./order.types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeliveryFeedback {
  itemAsDescribed: boolean;
  issueType?: string;
  deliveryPhotos?: string[];
  notes?: string;
}

// ── confirmDelivery ───────────────────────────────────────────────────────────

export async function confirmDelivery(
  orderId: string,
  buyerId: string,
  feedback?: DeliveryFeedback,
): Promise<void> {
  logger.info("order.confirm_delivery.attempting", { orderId, buyerId });

  const order = await orderRepository.findByIdForDelivery(orderId);

  if (!order) throw AppError.notFound("Order");

  if (order.buyerId !== buyerId) {
    throw AppError.unauthorised("Only the buyer can confirm delivery.");
  }

  if (order.status !== "DISPATCHED" && order.status !== "DELIVERED") {
    throw new AppError(
      "ORDER_WRONG_STATE",
      "Order is not in a deliverable state.",
      400,
    );
  }

  if (!order.stripePaymentIntentId) {
    logger.error("order.confirm_delivery.no_payment_intent", {
      orderId,
      buyerId,
    });
    throw AppError.missingPaymentIntent();
  }

  // Stripe FIRST — then DB
  await paymentService.capturePayment({
    paymentIntentId: order.stripePaymentIntentId,
    orderId,
  });

  // DB update ONLY after Stripe success — callback form for transitionOrder
  await orderRepository.$transaction(async (tx) => {
    await transitionOrder(
      orderId,
      "COMPLETED",
      { completedAt: new Date() },
      { tx, fromStatus: order.status },
    );
    await orderRepository.markPayoutsProcessing(orderId, tx);
    await orderRepository.markListingSold(order.listingId, tx);
  });

  // Queue payout processing (3 business days delay)
  try {
    const seller = await orderRepository.findSellerStripeAccount(
      order.sellerId,
    );
    if (seller?.stripeAccountId) {
      const { payoutQueue } = await import("@/lib/queue");
      await payoutQueue.add(
        "process-payout",
        {
          orderId,
          sellerId: order.sellerId,
          amountNzd: order.totalNzd,
          stripeAccountId: seller.stripeAccountId,
          correlationId: getRequestContext()?.correlationId,
        },
        {
          delay: 3 * 24 * 60 * 60 * 1000,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        },
      );
    }
  } catch {
    logger.warn("order.payout_queue.failed", { orderId });
  }

  audit({
    userId: buyerId,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: orderId,
    metadata: { newStatus: "COMPLETED", previousStatus: order.status },
  });

  // Record delivery confirmation event with feedback metadata
  if (feedback?.itemAsDescribed) {
    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.DELIVERY_CONFIRMED_OK,
      actorId: buyerId,
      actorRole: ACTOR_ROLES.BUYER,
      summary: "Buyer confirmed delivery — item arrived as described",
      metadata: { deliveryConfirmed: true, itemAsDescribed: true },
    });
  } else if (feedback && !feedback.itemAsDescribed) {
    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.DELIVERY_ISSUE_REPORTED,
      actorId: buyerId,
      actorRole: ACTOR_ROLES.BUYER,
      summary: `Buyer reported delivery issue: ${feedback.issueType?.replace(/_/g, " ").toLowerCase() ?? "unknown"}`,
      metadata: {
        deliveryConfirmed: true,
        itemAsDescribed: false,
        issueType: feedback.issueType,
        deliveryPhotos: feedback.deliveryPhotos,
        notes: feedback.notes,
      },
    });
  }

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.COMPLETED,
    actorId: buyerId,
    actorRole: ACTOR_ROLES.BUYER,
    summary: "Buyer confirmed delivery — payment released to seller",
  });

  // If buyer reported an issue, auto-create a DELIVERY_ISSUE interaction
  if (feedback && !feedback.itemAsDescribed && feedback.issueType) {
    try {
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours
      await orderInteractionService.createInteraction({
        orderId,
        type: INTERACTION_TYPES.DELIVERY_ISSUE,
        initiatedById: buyerId,
        initiatorRole: "BUYER",
        reason: `Delivery issue: ${feedback.issueType.replace(/_/g, " ").toLowerCase()}${feedback.notes ? ` — ${feedback.notes}` : ""}`,
        details: {
          issueType: feedback.issueType,
          deliveryPhotos: feedback.deliveryPhotos,
          notes: feedback.notes,
        },
        expiresAt,
        autoAction: AUTO_ACTIONS.AUTO_ESCALATE,
      });

      // Notify seller about the delivery issue
      createNotification({
        userId: order.sellerId,
        type: "ORDER_DISPUTED",
        title: "Buyer reported a delivery issue",
        body: `The buyer reported an issue: ${feedback.issueType.replace(/_/g, " ").toLowerCase()}. You have 72 hours to respond.`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});
    } catch (err) {
      logger.warn("order.delivery_issue.interaction_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Notify seller that payment has been released
  const listing = await orderRepository.findListingTitle(order.listingId);
  createNotification({
    userId: order.sellerId,
    type: "ORDER_COMPLETED",
    title: "Payment released! 💰",
    body: `Buyer confirmed delivery${listing ? ` of "${listing.title}"` : ""}. Your payout is being processed.`,
    listingId: order.listingId,
    orderId,
    link: "/dashboard/seller?tab=orders",
  }).catch(() => {});

  logger.info("order.delivery_confirmed", {
    orderId,
    buyerId,
    sellerId: order.sellerId,
  });
}

// ── markDispatched ────────────────────────────────────────────────────────────

export async function markDispatched(
  input: DispatchOrderInput,
  sellerId: string,
): Promise<void> {
  logger.info("order.dispatch.attempting", {
    orderId: input.orderId,
    sellerId,
  });

  const order = await orderRepository.findByIdForDispatch(input.orderId);

  if (!order) throw AppError.notFound("Order");

  if (order.sellerId !== sellerId) {
    throw AppError.unauthorised(
      "Only the seller can mark an order as dispatched.",
    );
  }

  if (order.status !== "PAYMENT_HELD") {
    throw new AppError(
      "ORDER_WRONG_STATE",
      "Order must be in PAYMENT_HELD status to dispatch.",
      400,
    );
  }

  await transitionOrder(
    input.orderId,
    "DISPATCHED",
    {
      dispatchedAt: new Date(),
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl ?? null,
    },
    { fromStatus: order.status },
  );

  // Notify buyer directly — BullMQ worker does not run on Vercel serverless
  try {
    await sendOrderDispatchedEmail({
      to: order.buyer.email,
      buyerName: order.buyer.displayName,
      listingTitle: order.listing.title,
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl,
      orderUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/buyer`,
    });
  } catch (err) {
    logger.warn("order.dispatch.email.failed", {
      orderId: input.orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  audit({
    userId: sellerId,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: input.orderId,
    metadata: {
      newStatus: "DISPATCHED",
      trackingNumber: input.trackingNumber,
    },
  });

  orderEventService.recordEvent({
    orderId: input.orderId,
    type: ORDER_EVENT_TYPES.DISPATCHED,
    actorId: sellerId,
    actorRole: ACTOR_ROLES.SELLER,
    summary: `Seller dispatched order via ${input.courier} — tracking: ${input.trackingNumber}`,
    metadata: {
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl,
      courier: input.courier,
      estimatedDeliveryDate: input.estimatedDeliveryDate,
      dispatchPhotos: input.dispatchPhotos,
    },
  });

  // Notify buyer that their item has been dispatched
  createNotification({
    userId: order.buyerId,
    type: "ORDER_DISPATCHED",
    title: "Your item has been dispatched 📦",
    body: `"${order.listing.title}" is on its way!${input.trackingNumber ? ` Tracking: ${input.trackingNumber}` : ""}`,
    orderId: input.orderId,
    link: "/dashboard/buyer?tab=orders",
  }).catch(() => {});

  logger.info("order.dispatched", { orderId: input.orderId, sellerId });
}
