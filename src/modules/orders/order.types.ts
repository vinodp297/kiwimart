// src/modules/orders/order.types.ts
// ─── Order Domain Types ──────────────────────────────────────────────────────

export interface CreateOrderInput {
  listingId: string;
  shippingAddress?: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postcode: string;
  };
}

export interface DispatchOrderInput {
  orderId: string;
  trackingNumber: string;
  courier: string;
  trackingUrl?: string;
  estimatedDeliveryDate: string; // ISO date string, 1-14 days from today
  dispatchPhotos: string[]; // R2 keys, 1-4 photos
}

export interface OpenDisputeInput {
  orderId: string;
  reason:
    | "ITEM_NOT_RECEIVED"
    | "ITEM_NOT_AS_DESCRIBED"
    | "ITEM_DAMAGED"
    | "WRONG_ITEM_SENT"
    | "COUNTERFEIT_ITEM"
    | "SELLER_UNRESPONSIVE"
    | "SELLER_CANCELLED"
    | "REFUND_NOT_PROCESSED"
    | "OTHER";
  description: string;
  evidenceUrls?: string[];
}

export interface OrderCreateResult {
  orderId: string;
  clientSecret: string;
}
