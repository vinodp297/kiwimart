// src/lib/seller-tiers.ts
// ─── Unified Seller Tier Definitions ────────────────────────────────────────
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  TWO INDEPENDENT TIER SYSTEMS — DO NOT CONFUSE THEM                     │
// ├─────────────────────────────────────────────────────────────────────────┤
// │  1. PERFORMANCE TIER  (BRONZE / SILVER / GOLD)                          │
// │     Computed from sales volume, average rating, and completion rate.     │
// │     Determines seller badges, search ranking boosts, and payout perks.   │
// │     Can be overridden by admins via User.sellerTierOverride.             │
// │     Stored on: User.sellerTierOverride (when set by admin/system)        │
// │                                                                          │
// │  2. VERIFICATION TIER  (LEVEL_1 / LEVEL_2 / LEVEL_3)                   │
// │     Derived from User.idVerified and User.phoneVerified flags.           │
// │     Determines listing limits, price caps, and platform trust level.     │
// │     LEVEL_1 = no verification, LEVEL_2 = phone verified,                │
// │     LEVEL_3 = phone + ID verified.                                       │
// │     Stored on: User.idVerified + User.phoneVerified (not a field itself) │
// ├─────────────────────────────────────────────────────────────────────────┤
// │  These systems are orthogonal. A seller can be GOLD + LEVEL_1           │
// │  (high performer, unverified) or BRONZE + LEVEL_3 (new but verified).   │
// └─────────────────────────────────────────────────────────────────────────┘
//
// TWO VERSIONS of each function:
// - Sync versions (client-safe): use static defaults, safe for "use client" components
// - Async versions (server-only): read from PlatformConfig DB table
//
// Client components import the sync versions.
// Server components and services import the async versions.

// ── Performance Tiers ────────────────────────────────────────────────────────

export type PerformanceTier = "BRONZE" | "SILVER" | "GOLD" | null;

/** Static tier requirements — used as defaults and for client-side display. */
export const TIER_REQUIREMENTS_DEFAULT = {
  BRONZE: { sales: 5, rating: 3.5, completionRate: 80 },
  SILVER: { sales: 20, rating: 4.0, completionRate: 90 },
  GOLD: { sales: 50, rating: 4.5, completionRate: 95 },
} as const;

export type TierRequirements = {
  BRONZE: { sales: number; rating: number; completionRate: number };
  SILVER: { sales: number; rating: number; completionRate: number };
  GOLD: { sales: number; rating: number; completionRate: number };
};

/**
 * Client-safe sync tier calculation. Uses provided thresholds
 * (defaults to static TIER_REQUIREMENTS_DEFAULT).
 */
export function calculateSellerTierSync(
  data: {
    completedSales: number;
    avgRating: number;
    completionRate: number;
  },
  requirements: TierRequirements = TIER_REQUIREMENTS_DEFAULT,
): PerformanceTier {
  const { GOLD, SILVER, BRONZE } = requirements;
  if (
    data.completedSales >= GOLD.sales &&
    data.avgRating >= GOLD.rating &&
    data.completionRate >= GOLD.completionRate
  )
    return "GOLD";
  if (
    data.completedSales >= SILVER.sales &&
    data.avgRating >= SILVER.rating &&
    data.completionRate >= SILVER.completionRate
  )
    return "SILVER";
  if (
    data.completedSales >= BRONZE.sales &&
    data.avgRating >= BRONZE.rating &&
    data.completionRate >= BRONZE.completionRate
  )
    return "BRONZE";
  return null;
}

// ── Display Config (static, client-safe) ────────────────────────────────────

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

// NOTE: getSellerTier() and getAllSellerTiers() have moved to
// @/lib/seller-tiers.server — import from there in server components/services.
