import "server-only";
// src/modules/payments/fee-calculator.ts
// ─── Platform Fee Calculator ────────────────────────────────────────────────
// Computes the full fee breakdown for a transaction:
//   grossAmount → stripeFee + platformFee → sellerPayout
//
// All amounts are in INTEGER CENTS (NZD). No floating-point money.
//
// Fee model:
//   • Buyer pays the listed price (no surcharges).
//   • Seller pays: Stripe processing fee + tiered platform fee.
//   • Platform fee varies by seller performance tier (GOLD/SILVER/STANDARD).
//   • Platform fee has a min (50c) and max ($50) clamp.
//   • Stripe fee: 1.9% + 30c (NZ domestic cards).

import type { PerformanceTier } from "@/lib/seller-tiers";
import {
  getConfigFloat,
  getConfigInt,
  CONFIG_KEYS,
} from "@/lib/platform-config";
import {
  STRIPE_FEE_RATE as DEFAULT_STRIPE_FEE_RATE,
  STRIPE_FEE_FIXED_CENTS as DEFAULT_STRIPE_FIXED_CENTS,
  DEFAULT_PLATFORM_FEE_RATE,
} from "@/lib/currency";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FeeBreakdown {
  /** Original listing price in cents (what the buyer pays) */
  grossAmountCents: number;
  /** Stripe processing fee in cents */
  stripeFee: number;
  /** Platform commission fee in cents (after min/max clamp) */
  platformFee: number;
  /** Effective platform fee rate applied (as a decimal, e.g. 0.035) */
  platformFeeRate: number;
  /** Total fees deducted from seller (stripeFee + platformFee) */
  totalFees: number;
  /** Net amount seller receives (grossAmount - totalFees) */
  sellerPayout: number;
  /** Seller's performance tier used for rate selection */
  tier: PerformanceTier | "STANDARD";
}

// ── Sync calculator (uses hardcoded defaults) ────────────────────────────────

/**
 * Calculate fees synchronously using hardcoded default rates.
 * Use this for client-side fee previews or when config is unavailable.
 */
export function calculateFeesSync(
  grossAmountCents: number,
  sellerTier: PerformanceTier = null,
): FeeBreakdown {
  return computeFees(grossAmountCents, sellerTier, {
    standardRate: DEFAULT_PLATFORM_FEE_RATE,
    silverRate: 0.03,
    goldRate: 0.025,
    minCents: 50,
    maxCents: 5000,
    stripeRate: DEFAULT_STRIPE_FEE_RATE,
    stripeFixedCents: DEFAULT_STRIPE_FIXED_CENTS,
  });
}

// ── Async calculator (reads from PlatformConfig) ─────────────────────────────

/**
 * Calculate fees using admin-configurable rates from PlatformConfig.
 * This is the primary calculator — use it in all server-side payment flows.
 */
export async function calculateFees(
  grossAmountCents: number,
  sellerTier: PerformanceTier = null,
): Promise<FeeBreakdown> {
  const [
    standardRate,
    silverRate,
    goldRate,
    minCents,
    maxCents,
    stripeRate,
    stripeFixedCents,
  ] = await Promise.all([
    getConfigFloat(CONFIG_KEYS.PLATFORM_FEE_STANDARD_RATE),
    getConfigFloat(CONFIG_KEYS.PLATFORM_FEE_SILVER_RATE),
    getConfigFloat(CONFIG_KEYS.PLATFORM_FEE_GOLD_RATE),
    getConfigInt(CONFIG_KEYS.PLATFORM_FEE_MINIMUM_CENTS),
    getConfigInt(CONFIG_KEYS.PLATFORM_FEE_MAXIMUM_CENTS),
    getConfigFloat(CONFIG_KEYS.STRIPE_FEE_RATE),
    getConfigInt(CONFIG_KEYS.STRIPE_FEE_FIXED_CENTS),
  ]);

  return computeFees(grossAmountCents, sellerTier, {
    // Config stores percentages (3.5), convert to decimal (0.035)
    standardRate: standardRate / 100,
    silverRate: silverRate / 100,
    goldRate: goldRate / 100,
    minCents,
    maxCents,
    // Config stores percentage (1.9), convert to decimal (0.019)
    stripeRate: stripeRate / 100,
    stripeFixedCents,
  });
}

// ── Internal computation ─────────────────────────────────────────────────────

interface FeeConfig {
  standardRate: number; // decimal, e.g. 0.035
  silverRate: number;
  goldRate: number;
  minCents: number;
  maxCents: number;
  stripeRate: number; // decimal, e.g. 0.019
  stripeFixedCents: number;
}

function computeFees(
  grossAmountCents: number,
  sellerTier: PerformanceTier,
  config: FeeConfig,
): FeeBreakdown {
  // 1. Select tier rate
  let platformFeeRate: number;
  let tierLabel: PerformanceTier | "STANDARD";

  switch (sellerTier) {
    case "GOLD":
      platformFeeRate = config.goldRate;
      tierLabel = "GOLD";
      break;
    case "SILVER":
      platformFeeRate = config.silverRate;
      tierLabel = "SILVER";
      break;
    case "BRONZE":
      // Bronze sellers use the standard rate — no discount
      platformFeeRate = config.standardRate;
      tierLabel = "STANDARD";
      break;
    default:
      // null / untiered → standard rate
      platformFeeRate = config.standardRate;
      tierLabel = "STANDARD";
      break;
  }

  // 2. Stripe fee (integer math)
  const stripeFee = Math.round(
    grossAmountCents * config.stripeRate + config.stripeFixedCents,
  );

  // 3. Platform fee with min/max clamp (integer math)
  const rawPlatformFee = Math.round(grossAmountCents * platformFeeRate);
  const platformFee = Math.max(
    config.minCents,
    Math.min(config.maxCents, rawPlatformFee),
  );

  // 4. Totals
  const totalFees = stripeFee + platformFee;
  const sellerPayout = grossAmountCents - totalFees;

  return {
    grossAmountCents,
    stripeFee,
    platformFee,
    platformFeeRate,
    totalFees,
    sellerPayout,
    tier: tierLabel,
  };
}
