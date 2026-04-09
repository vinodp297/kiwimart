// src/lib/currency.ts
// ─── Canonical currency utilities ────────────────────────────────────────────
// Single source of truth for all NZD/cents conversions and fee calculations.
//
// Rules:
//   • toCents()          — dollar → cents (always use Math.round, never inline)
//   • fromCents()        — cents  → dollar number (never divide inline)
//   • formatCentsAsNzd() — server-side display: emails, logs, notifications
//   • formatNzd()        — UI display: React components
//   • calculateStripeFee — never hardcode 0.019 or 0.30
//   • For platform fees  — use fee-calculator.ts (tier-aware, config-backed)

// ── Stripe / platform fee constants ──────────────────────────────────────────

export const STRIPE_FEE_RATE = 0.019; // 1.9% per-transaction fee
export const STRIPE_FEE_FIXED_CENTS = 30; // 30-cent fixed component

/** Default platform fee rate (3.5% for Standard tier).
 *  For tier-aware fees, use calculateFees() from fee-calculator.ts. */
export const DEFAULT_PLATFORM_FEE_RATE = 0.035;

// ── Core conversions ──────────────────────────────────────────────────────────

/** Dollar value → whole cents.  Always uses Math.round — never floor or ceil. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Cents → dollar number (no formatting). */
export function fromCents(cents: number): number {
  return cents / 100;
}

// ── Formatters ────────────────────────────────────────────────────────────────

/**
 * Server-side NZD formatter — for emails, notifications, audit logs.
 * Returns: "$50.99 NZD"
 */
export function formatCentsAsNzd(cents: number): string {
  return `$${(cents / 100).toFixed(2)} NZD`;
}

/**
 * UI NZD formatter — for display in React components.
 * Returns: "$50.99" (locale-formatted, no NZD suffix)
 */
export function formatNzd(cents: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// ── Fee calculations ──────────────────────────────────────────────────────────

/** Stripe processing fee for a given amount (cents). */
export function calculateStripeFee(amountCents: number): number {
  return Math.round(amountCents * STRIPE_FEE_RATE + STRIPE_FEE_FIXED_CENTS);
}
