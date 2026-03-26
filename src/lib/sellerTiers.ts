// src/lib/sellerTiers.ts
// ─── Seller Tier Definitions ──────────────────────────────────────────────────
// KiwiMart uses a 3-tier seller system that unlocks capabilities progressively.

export type SellerTierName = 'basic' | 'phone_verified' | 'id_verified'

export interface SellerTier {
  name: SellerTierName
  label: string
  description: string
  /** Capabilities unlocked at this tier */
  perks: string[]
  /** Max active listings (null = unlimited) */
  maxListings: number | null
  /** Stripe payout delay in days */
  payoutDelayDays: number
}

export const SELLER_TIERS: Record<SellerTierName, SellerTier> = {
  basic: {
    name: 'basic',
    label: 'Basic Seller',
    description: 'Create listings and receive payments. Payouts held 7 days.',
    perks: ['Create up to 10 listings', 'Accept payments via Stripe', '7-day payout hold'],
    maxListings: 10,
    payoutDelayDays: 7,
  },
  phone_verified: {
    name: 'phone_verified',
    label: 'Verified Seller',
    description: 'Phone verification coming soon — use ID verification for unlimited access now.',
    perks: [
      'Create up to 50 listings',
      'Accept payments via Stripe',
      '3-day payout hold',
      'Verified badge on profile',
    ],
    maxListings: 50,
    payoutDelayDays: 3,
  },
  id_verified: {
    name: 'id_verified',
    label: 'ID-Verified Seller',
    description: 'Fully verified sellers unlock unlimited listings and next-day payouts.',
    perks: [
      'Unlimited listings',
      'Next-day payout',
      'Priority support',
      'ID-verified badge',
      'Featured in search results',
    ],
    maxListings: null,
    payoutDelayDays: 1,
  },
}

/** Determine a user's current seller tier from their profile flags. */
export function getSellerTier(user: {
  phoneVerified?: boolean | null
  idVerified?: boolean | null
}): SellerTier {
  if (user.idVerified) return SELLER_TIERS.id_verified
  if (user.phoneVerified) return SELLER_TIERS.phone_verified
  return SELLER_TIERS.basic
}
