// src/modules/orders/order.types.ts
// ─── Order Domain Types ──────────────────────────────────────────────────────

export interface CreateOrderInput {
  listingId: string
  shippingAddress?: {
    name: string
    line1: string
    line2?: string
    city: string
    region: string
    postcode: string
  }
}

export interface DispatchOrderInput {
  orderId: string
  trackingNumber?: string
  trackingUrl?: string
}

export interface OpenDisputeInput {
  orderId: string
  reason: 'ITEM_NOT_RECEIVED' | 'ITEM_NOT_AS_DESCRIBED' | 'ITEM_DAMAGED' | 'SELLER_UNRESPONSIVE' | 'OTHER'
  description: string
}

export interface OrderCreateResult {
  orderId: string
  clientSecret: string
}
