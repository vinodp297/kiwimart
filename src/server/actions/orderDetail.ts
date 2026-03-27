'use server';
import { safeActionError } from '@/shared/errors'
// src/server/actions/orderDetail.ts
// ─── Order Detail Server Action ─────────────────────────────────────────────

import { requireUser } from '@/server/lib/requireUser';
import db from '@/lib/db';
import type { ActionResult } from '@/types';

function r2Url(key: string | null): string {
  if (!key) return 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=480&h=480&fit=crop';
  if (key.startsWith('http')) return key;
  return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${key}`;
}

const STATUS_MAP: Record<string, string> = {
  AWAITING_PAYMENT: 'awaiting_payment',
  PAYMENT_HELD: 'payment_held',
  DISPATCHED: 'dispatched',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  DISPUTED: 'disputed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
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
  trackingNumber: string | null;
  trackingUrl: string | null;
  disputeReason: string | null;
  isBuyer: boolean;
  buyerId: string;
  sellerId: string;
  otherPartyName: string;
  otherPartyUsername: string;
  hasReview: boolean;
}

export async function fetchOrderDetail(
  orderId: string
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
        trackingNumber: true,
        trackingUrl: true,
        disputeReason: true,
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

    if (!order) return { success: false, error: 'Order not found.' };

    const isBuyer = order.buyerId === user.id;
    const isSeller = order.sellerId === user.id;
    if (!isBuyer && !isSeller) {
      return { success: false, error: 'You do not have permission to view this order.' };
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
        trackingNumber: order.trackingNumber,
        trackingUrl: order.trackingUrl,
        disputeReason: order.disputeReason,
        isBuyer,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        otherPartyName: isBuyer ? order.seller.displayName : order.buyer.displayName,
        otherPartyUsername: isBuyer ? order.seller.username : order.buyer.username,
        hasReview: !!order.review,
      },
    };
  } catch (err) {
    return { success: false, error: safeActionError(err) };
  }
}
