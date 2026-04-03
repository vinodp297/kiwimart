import "server-only";
// src/lib/seller-tiers.server.ts
// ─── Server-Only Seller Tier Functions ──────────────────────────────────────
//
// These async functions read from PlatformConfig (DB-backed) and must only
// run on the server. Client components import the sync equivalents from
// @/lib/seller-tiers instead.

import {
  calculateSellerTierSync,
  type PerformanceTier,
  type TierRequirements,
  type SellerTier,
  type SellerTierName,
} from "./seller-tiers";

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
