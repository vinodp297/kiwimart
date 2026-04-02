"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/orderDetail.ts
// ─── Order Detail Server Action ─────────────────────────────────────────────

import { requireUser } from "@/server/lib/requireUser";
import db from "@/lib/db";
import { getImageUrl } from "@/lib/image";
import type { ActionResult } from "@/types";

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
  // Dispute data from standalone Dispute model
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
  cancelledBy: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  // Pickup fields
  fulfillmentType: string;
  pickupStatus: string | null;
  pickupScheduledAt: string | null;
  pickupWindowExpiresAt: string | null;
  otpExpiresAt: string | null;
  rescheduleCount: number;
}

export async function fetchOrderDetail(
  orderId: string,
): Promise<ActionResult<OrderDetailData>> {
  try {
    const user = await requireUser();

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        itemNzd: true,
        shippingNzd: true,
        totalNzd: true,
        status: true,
        createdAt: true,
        dispatchedAt: true,
        deliveredAt: true,
        completedAt: true,
        trackingNumber: true,
        trackingUrl: true,
        dispute: {
          select: {
            reason: true,
            status: true,
            buyerStatement: true,
            sellerStatement: true,
            openedAt: true,
            sellerRespondedAt: true,
            resolvedAt: true,
          },
        },
        cancelledBy: true,
        cancelReason: true,
        cancelledAt: true,
        fulfillmentType: true,
        pickupStatus: true,
        pickupScheduledAt: true,
        pickupWindowExpiresAt: true,
        otpExpiresAt: true,
        rescheduleCount: true,
        listing: {
          select: {
            title: true,
            images: { where: { order: 0 }, select: { r2Key: true }, take: 1 },
          },
        },
        buyer: { select: { displayName: true, username: true } },
        seller: { select: { displayName: true, username: true } },
        review: { select: { id: true } },
      },
    });

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
        hasReview: !!order.review,
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
