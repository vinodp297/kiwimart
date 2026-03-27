// src/modules/payments/payment.types.ts
// ─── Payment Domain Types ────────────────────────────────────────────────────

export interface CreatePaymentIntentInput {
  amountNzd: number          // in cents
  sellerId: string
  sellerStripeAccountId: string
  orderId: string
  listingId: string
  listingTitle: string
  buyerId: string
  metadata?: Record<string, string>
  /** Checkout session key — passed to Stripe to prevent duplicate PaymentIntents */
  idempotencyKey?: string
}

export interface CapturePaymentInput {
  paymentIntentId: string
  orderId: string
}

export interface RefundPaymentInput {
  paymentIntentId: string
  orderId: string
  reason?: string
}

export interface PaymentResult {
  paymentIntentId: string
  clientSecret: string
  amount: number
}
