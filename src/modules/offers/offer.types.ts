// src/modules/offers/offer.types.ts
// ─── Offer Domain Types ─────────────────────────────────────────────────────

export interface CreateOfferInput {
  listingId: string
  amount: number
  note?: string
}

export interface RespondOfferInput {
  offerId: string
  action: 'ACCEPT' | 'DECLINE'
  declineNote?: string
}
