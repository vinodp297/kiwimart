"use server";
// src/server/actions/order-query.actions.ts
// ─── Order read-only query server actions ─────────────────────────────────────
// Consolidates fetchOrderDetail (ex orderDetail.ts) and getOrderTimeline
// (ex orderEvents.ts) into a single read-only actions file.

import { safeActionError } from "@/shared/errors";
import { requireUser } from "@/server/lib/requireUser";
import { orderRepository } from "@/modules/orders/order.repository";
import { orderEventService } from "@/modules/orders/order-event.service";
import { interactionRepository } from "@/modules/orders/interaction.repository";
import { getImageUrl } from "@/lib/image";
import { logger } from "@/shared/logger";
import type { ActionResult } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

function r2Url(key: string | null): string {
  return getImageUrl(key);
}

const STATUS_MAP: Record<string, string> = {
  AWAITING_PAYMENT: "awaiting_payment",
  PAYMENT_HELD: "payment_held",
  AWAITING_PICKUP: "awaiting_pickup",
  DISPATCHED: "dispatched",
  DELIVERED: "delivered",
  COMPLETED: "completed",
  DISPUTED: "disputed",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
};

export interface OrderDetailData {
  id: string;
  listingId: string;
  listingTitle: string;
  listingThumbnail: string;
  status: string;
  itemPrice: number;
  shippingPrice: number;
  total: number;
  createdAt: string;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  dispute: {
    reason: string;
    status: string;
    buyerStatement: string | null;
    sellerStatement: string | null;
    openedAt: string;
    sellerRespondedAt: string | null;
    resolvedAt: string | null;
  } | null;
  isBuyer: boolean;
  buyerId: string;
  sellerId: string;
  otherPartyName: string;
  otherPartyUsername: string;
  hasReview: boolean;
  hasBuyerReview: boolean;
  hasSellerReview: boolean;
  cancelledBy: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  fulfillmentType: string;
  pickupStatus: string | null;
  pickupScheduledAt: string | null;
  pickupWindowExpiresAt: string | null;
  otpExpiresAt: string | null;
  rescheduleCount: number;
  payout: {
    status: string;
    amountNzd: number;
    platformFeeNzd: number;
    stripeFeeNzd: number;
    sellerPayoutNzd: number;
  } | null;
}

export interface TimelineEventData {
  id: string;
  type: string;
  actorRole: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { displayName: string | null; username: string } | null;
}

// ── fetchOrderDetail ──────────────────────────────────────────────────────────

export async function fetchOrderDetail(
  orderId: string,
): Promise<ActionResult<OrderDetailData>> {
  try {
    const user = await requireUser();
    const order = await orderRepository.findForOrderDetail(orderId);

    if (!order) return { success: false, error: "Order not found." };

    const isBuyer = order.buyerId === user.id;
    const isSeller = order.sellerId === user.id;
    if (!isBuyer && !isSeller) {
      return {
        success: false,
        error: "You do not have permission to view this order.",
      };
    }

    return {
      success: true,
      data: {
        id: order.id,
        listingId: order.listingId,
        listingTitle: order.listing.title,
        listingThumbnail: r2Url(order.listing.images[0]?.r2Key ?? null),
        status: STATUS_MAP[order.status] ?? order.status.toLowerCase(),
        itemPrice: order.itemNzd / 100,
        shippingPrice: order.shippingNzd / 100,
        total: order.totalNzd / 100,
        createdAt: order.createdAt.toISOString(),
        dispatchedAt: order.dispatchedAt?.toISOString() ?? null,
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
        completedAt: order.completedAt?.toISOString() ?? null,
        trackingNumber: order.trackingNumber,
        trackingUrl: order.trackingUrl,
        dispute: order.dispute
          ? {
              reason: order.dispute.reason,
              status: order.dispute.status,
              buyerStatement: order.dispute.buyerStatement,
              sellerStatement: order.dispute.sellerStatement,
              openedAt: order.dispute.openedAt.toISOString(),
              sellerRespondedAt:
                order.dispute.sellerRespondedAt?.toISOString() ?? null,
              resolvedAt: order.dispute.resolvedAt?.toISOString() ?? null,
            }
          : null,
        cancelledBy: order.cancelledBy ?? null,
        cancelReason: order.cancelReason ?? null,
        cancelledAt: order.cancelledAt?.toISOString() ?? null,
        fulfillmentType: order.fulfillmentType,
        pickupStatus: order.pickupStatus,
        pickupScheduledAt: order.pickupScheduledAt?.toISOString() ?? null,
        pickupWindowExpiresAt:
          order.pickupWindowExpiresAt?.toISOString() ?? null,
        otpExpiresAt: order.otpExpiresAt?.toISOString() ?? null,
        rescheduleCount: order.rescheduleCount,
        isBuyer,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        otherPartyName: isBuyer
          ? order.seller.displayName
          : order.buyer.displayName,
        otherPartyUsername: isBuyer
          ? order.seller.username
          : order.buyer.username,
        hasReview: order.reviews.length > 0,
        hasBuyerReview: order.reviews.some((r) => r.reviewerRole === "BUYER"),
        hasSellerReview: order.reviews.some((r) => r.reviewerRole === "SELLER"),
        payout:
          !isBuyer && order.payout
            ? {
                status: order.payout.status,
                amountNzd: order.payout.amountNzd,
                platformFeeNzd: order.payout.platformFeeNzd,
                stripeFeeNzd: order.payout.stripeFeeNzd,
                sellerPayoutNzd:
                  order.payout.amountNzd -
                  order.payout.platformFeeNzd -
                  order.payout.stripeFeeNzd,
              }
            : null,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't load order details. Please refresh the page.",
      ),
    };
  }
}

// ── getOrderTimeline ──────────────────────────────────────────────────────────

export async function getOrderTimeline(
  orderId: string,
): Promise<ActionResult<TimelineEventData[]>> {
  try {
    const user = await requireUser();

    const order = await interactionRepository.findOrderParties(orderId);
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

    const events = await orderEventService.getOrderTimeline(orderId);

    return {
      success: true,
      data: events.map((e) => ({
        id: e.id,
        type: e.type,
        actorRole: e.actorRole,
        summary: e.summary,
        metadata: e.metadata as Record<string, unknown> | null,
        createdAt: e.createdAt.toISOString(),
        actor: e.actor
          ? { displayName: e.actor.displayName, username: e.actor.username }
          : null,
      })),
    };
  } catch (error) {
    logger.error("order.timeline.fetch_failed", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Could not load order timeline." };
  }
}
