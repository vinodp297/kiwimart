// Shared types for order detail page components

import type { InteractionData } from "@/server/actions/interactions";
import type { TimelineEvent } from "@/components/OrderTimeline";

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
  hasBuyerReview: boolean;
  hasSellerReview: boolean;
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

export type { InteractionData, TimelineEvent };
