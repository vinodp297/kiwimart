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

/**
 * Server-only async tier calculation. Reads thresholds from PlatformConfig.
 * Supports admin/system tier override.
 */
export async function calculateSellerTier(
  data: {
    completedSales: number;
    avgRating: number;
    completionRate: number;
  },
  overrideTier?: string | null,
): Promise<PerformanceTier> {
  // Check for admin/system override first
  if (
    overrideTier === "GOLD" ||
    overrideTier === "SILVER" ||
    overrideTier === "BRONZE"
  ) {
    return overrideTier;
  }

  const { getConfigMany, CONFIG_KEYS } = await import("@/lib/platform-config");

  const cfg = await getConfigMany([
    CONFIG_KEYS.GOLD_MIN_SALES,
    CONFIG_KEYS.GOLD_MIN_RATING,
    CONFIG_KEYS.GOLD_MIN_COMPLETION_RATE,
    CONFIG_KEYS.SILVER_MIN_SALES,
    CONFIG_KEYS.SILVER_MIN_RATING,
    CONFIG_KEYS.SILVER_MIN_COMPLETION_RATE,
    CONFIG_KEYS.BRONZE_MIN_SALES,
    CONFIG_KEYS.BRONZE_MIN_RATING,
    CONFIG_KEYS.BRONZE_MIN_COMPLETION_RATE,
  ]);

  const requirements: TierRequirements = {
    GOLD: {
      sales: parseInt(cfg.get(CONFIG_KEYS.GOLD_MIN_SALES) ?? "50", 10),
      rating: parseFloat(cfg.get(CONFIG_KEYS.GOLD_MIN_RATING) ?? "4.5"),
      completionRate: parseFloat(
        cfg.get(CONFIG_KEYS.GOLD_MIN_COMPLETION_RATE) ?? "95",
      ),
    },
    SILVER: {
      sales: parseInt(cfg.get(CONFIG_KEYS.SILVER_MIN_SALES) ?? "20", 10),
      rating: parseFloat(cfg.get(CONFIG_KEYS.SILVER_MIN_RATING) ?? "4.0"),
      completionRate: parseFloat(
        cfg.get(CONFIG_KEYS.SILVER_MIN_COMPLETION_RATE) ?? "90",
      ),
    },
    BRONZE: {
      sales: parseInt(cfg.get(CONFIG_KEYS.BRONZE_MIN_SALES) ?? "5", 10),
      rating: parseFloat(cfg.get(CONFIG_KEYS.BRONZE_MIN_RATING) ?? "3.5"),
      completionRate: parseFloat(
        cfg.get(CONFIG_KEYS.BRONZE_MIN_COMPLETION_RATE) ?? "80",
      ),
    },
  };

  return calculateSellerTierSync(data, requirements);
}

/**
 * Server-only: Fetch tier requirements from config for display purposes.
 */
export async function getTierRequirements(): Promise<TierRequirements> {
  const { getConfigMany, CONFIG_KEYS } = await import("@/lib/platform-config");

  const cfg = await getConfigMany([
    CONFIG_KEYS.GOLD_MIN_SALES,
    CONFIG_KEYS.GOLD_MIN_RATING,
    CONFIG_KEYS.GOLD_MIN_COMPLETION_RATE,
    CONFIG_KEYS.SILVER_MIN_SALES,
    CONFIG_KEYS.SILVER_MIN_RATING,
    CONFIG_KEYS.SILVER_MIN_COMPLETION_RATE,
    CONFIG_KEYS.BRONZE_MIN_SALES,
    CONFIG_KEYS.BRONZE_MIN_RATING,
    CONFIG_KEYS.BRONZE_MIN_COMPLETION_RATE,
  ]);

  return {
    BRONZE: {
      sales: parseInt(cfg.get(CONFIG_KEYS.BRONZE_MIN_SALES) ?? "5", 10),
      rating: parseFloat(cfg.get(CONFIG_KEYS.BRONZE_MIN_RATING) ?? "3.5"),
      completionRate: parseFloat(
        cfg.get(CONFIG_KEYS.BRONZE_MIN_COMPLETION_RATE) ?? "80",
      ),
    },
    SILVER: {
      sales: parseInt(cfg.get(CONFIG_KEYS.SILVER_MIN_SALES) ?? "20", 10),
      rating: parseFloat(cfg.get(CONFIG_KEYS.SILVER_MIN_RATING) ?? "4.0"),
      completionRate: parseFloat(
        cfg.get(CONFIG_KEYS.SILVER_MIN_COMPLETION_RATE) ?? "90",
      ),
    },
    GOLD: {
      sales: parseInt(cfg.get(CONFIG_KEYS.GOLD_MIN_SALES) ?? "50", 10),
      rating: parseFloat(cfg.get(CONFIG_KEYS.GOLD_MIN_RATING) ?? "4.5"),
      completionRate: parseFloat(
        cfg.get(CONFIG_KEYS.GOLD_MIN_COMPLETION_RATE) ?? "95",
      ),
    },
  };
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

/** Server-only: Determine a user's current seller tier with config-backed limits. */
export async function getSellerTier(user: {
  phoneVerified?: boolean | null;
  idVerified?: boolean | null;
}): Promise<SellerTier> {
  const { getConfigMany, CONFIG_KEYS } = await import("@/lib/platform-config");

  const cfg = await getConfigMany([
    CONFIG_KEYS.BASIC_MAX_LISTINGS,
    CONFIG_KEYS.PHONE_MAX_LISTINGS,
    CONFIG_KEYS.BASIC_PAYOUT_DELAY_DAYS,
    CONFIG_KEYS.PHONE_PAYOUT_DELAY_DAYS,
    CONFIG_KEYS.ID_PAYOUT_DELAY_DAYS,
  ]);

  const basicMax = parseInt(
    cfg.get(CONFIG_KEYS.BASIC_MAX_LISTINGS) ?? "10",
    10,
  );
  const phoneMax = parseInt(
    cfg.get(CONFIG_KEYS.PHONE_MAX_LISTINGS) ?? "50",
    10,
  );
  const basicPayout = parseInt(
    cfg.get(CONFIG_KEYS.BASIC_PAYOUT_DELAY_DAYS) ?? "7",
    10,
  );
  const phonePayout = parseInt(
    cfg.get(CONFIG_KEYS.PHONE_PAYOUT_DELAY_DAYS) ?? "3",
    10,
  );
  const idPayout = parseInt(
    cfg.get(CONFIG_KEYS.ID_PAYOUT_DELAY_DAYS) ?? "1",
    10,
  );

  const tiers: Record<SellerTierName, SellerTier> = {
    basic: {
      name: "basic",
      label: "Basic Seller",
      description: `Create listings and receive payments. Payouts held ${basicPayout} days.`,
      perks: [
        `Create up to ${basicMax} listings`,
        "Accept payments via Stripe",
        `${basicPayout}-day payout hold`,
      ],
      maxListings: basicMax,
      payoutDelayDays: basicPayout,
    },
    phone_verified: {
      name: "phone_verified",
      label: "Verified Seller",
      description:
        "Verify your phone number to unlock more listings and faster payouts.",
      perks: [
        `Create up to ${phoneMax} listings`,
        "Accept payments via Stripe",
        `${phonePayout}-day payout hold`,
        "Verified badge on profile",
      ],
      maxListings: phoneMax,
      payoutDelayDays: phonePayout,
    },
    id_verified: {
      name: "id_verified",
      label: "ID-Verified Seller",
      description:
        "Fully verified sellers unlock unlimited listings and next-day payouts.",
      perks: [
        "Unlimited listings",
        `${idPayout === 1 ? "Next-day" : `${idPayout}-day`} payout`,
        "Priority support",
        "ID-verified badge",
        "Featured in search results",
      ],
      maxListings: null,
      payoutDelayDays: idPayout,
    },
  };

  if (user.idVerified) return tiers.id_verified;
  if (user.phoneVerified) return tiers.phone_verified;
  return tiers.basic;
}

/**
 * Server-only: Get all seller tier definitions for display purposes.
 */
export async function getAllSellerTiers(): Promise<SellerTier[]> {
  const basic = await getSellerTier({});
  const phone = await getSellerTier({ phoneVerified: true });
  const id = await getSellerTier({ idVerified: true });
  return [basic, phone, id];
}
