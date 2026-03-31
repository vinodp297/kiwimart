// src/lib/seller-tiers.ts
// ─── Unified Seller Tier Definitions — safe for client + server ─────────────
// Performance tiers (BRONZE/SILVER/GOLD) are computed from sales data.
// Verification tiers (basic/phone_verified/id_verified) are based on account flags.

// ── Performance Tiers ────────────────────────────────────────────────────────

export type PerformanceTier = "BRONZE" | "SILVER" | "GOLD" | null;

export function calculateSellerTier(data: {
  completedSales: number;
  avgRating: number;
  completionRate: number;
}): PerformanceTier {
  if (
    data.completedSales >= 50 &&
    data.avgRating >= 4.5 &&
    data.completionRate >= 95
  )
    return "GOLD";
  if (
    data.completedSales >= 20 &&
    data.avgRating >= 4.0 &&
    data.completionRate >= 90
  )
    return "SILVER";
  if (
    data.completedSales >= 5 &&
    data.avgRating >= 3.5 &&
    data.completionRate >= 80
  )
    return "BRONZE";
  return null;
}

export const TIER_REQUIREMENTS = {
  BRONZE: { sales: 5, rating: 3.5, completionRate: 80 },
  SILVER: { sales: 20, rating: 4.0, completionRate: 90 },
  GOLD: { sales: 50, rating: 4.5, completionRate: 95 },
} as const;

export const TIER_CONFIG: Record<
  string,
  { label: string; colour: string; icon: string }
> = {
  GOLD: {
    label: "Gold Seller",
    colour: "text-amber-600 bg-amber-50 ring-amber-200",
    icon: "🥇",
  },
  SILVER: {
    label: "Silver Seller",
    colour: "text-gray-600 bg-gray-100 ring-gray-300",
    icon: "🥈",
  },
  BRONZE: {
    label: "Bronze Seller",
    colour: "text-orange-600 bg-orange-50 ring-orange-200",
    icon: "🥉",
  },
};

// ── Verification Tiers ───────────────────────────────────────────────────────

export type SellerTierName = "basic" | "phone_verified" | "id_verified";

export interface SellerTier {
  name: SellerTierName;
  label: string;
  description: string;
  /** Capabilities unlocked at this tier */
  perks: string[];
  /** Max active listings (null = unlimited) */
  maxListings: number | null;
  /** Stripe payout delay in days */
  payoutDelayDays: number;
}

export const SELLER_TIERS: Record<SellerTierName, SellerTier> = {
  basic: {
    name: "basic",
    label: "Basic Seller",
    description: "Create listings and receive payments. Payouts held 7 days.",
    perks: [
      "Create up to 10 listings",
      "Accept payments via Stripe",
      "7-day payout hold",
    ],
    maxListings: 10,
    payoutDelayDays: 7,
  },
  phone_verified: {
    name: "phone_verified",
    label: "Verified Seller",
    description:
      "Phone verification coming soon — use ID verification for unlimited access now.",
    perks: [
      "Create up to 50 listings",
      "Accept payments via Stripe",
      "3-day payout hold",
      "Verified badge on profile",
    ],
    maxListings: 50,
    payoutDelayDays: 3,
  },
  id_verified: {
    name: "id_verified",
    label: "ID-Verified Seller",
    description:
      "Fully verified sellers unlock unlimited listings and next-day payouts.",
    perks: [
      "Unlimited listings",
      "Next-day payout",
      "Priority support",
      "ID-verified badge",
      "Featured in search results",
    ],
    maxListings: null,
    payoutDelayDays: 1,
  },
};

/** Determine a user's current seller tier from their profile flags. */
export function getSellerTier(user: {
  phoneVerified?: boolean | null;
  idVerified?: boolean | null;
}): SellerTier {
  if (user.idVerified) return SELLER_TIERS.id_verified;
  if (user.phoneVerified) return SELLER_TIERS.phone_verified;
  return SELLER_TIERS.basic;
}
