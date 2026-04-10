// src/test/worker-coverage.test.ts
// ─── Worker coverage: fee-calculator minimum payout invariant,
//     tier fee comparisons, and getClientIp edge cases ───────────────────────

import { describe, it, expect, vi } from "vitest";

// ── Mocks required before imports ───────────────────────────────────────────

vi.mock("server-only", () => ({}));

vi.mock("@/lib/platform-config", () => ({
  getConfigFloat: vi.fn(),
  getConfigInt: vi.fn(),
  CONFIG_KEYS: {
    PLATFORM_FEE_STANDARD_RATE: "financial.fee.platform_standard_rate",
    PLATFORM_FEE_SILVER_RATE: "financial.fee.platform_silver_rate",
    PLATFORM_FEE_GOLD_RATE: "financial.fee.platform_gold_rate",
    PLATFORM_FEE_MINIMUM_CENTS: "financial.fee.platform_minimum_cents",
    PLATFORM_FEE_MAXIMUM_CENTS: "financial.fee.platform_maximum_cents",
    STRIPE_FEE_RATE: "financial.fee.stripe_rate",
    STRIPE_FEE_FIXED_CENTS: "financial.fee.stripe_fixed_cents",
  },
}));

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn(),
}));

// Override the global rateLimit mock from setup.ts so we can test the real
// getClientIp implementation while keeping rateLimit itself mocked.
vi.mock("@/server/lib/rateLimit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/lib/rateLimit")>();
  return {
    ...actual,
    rateLimit: vi.fn().mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    }),
  };
});

import { calculateFeesSync } from "@/modules/payments/fee-calculator";
import { getClientIp } from "@/server/lib/rateLimit";

// ── fee-calculator: minimum payout invariant ────────────────────────────────

describe("calculateFeesSync — minimum payout invariant", () => {
  // With grossAmountCents = 100 ($1.00):
  //   stripeFee  = round(100 * 0.019 + 30) = round(31.9) = 32
  //   platformFee = max(50, round(100 * 0.035)) = max(50, 4) = 50
  //   totalFees  = 32 + 50 = 82
  //   sellerPayout = 100 - 82 = 18  →  18 < MINIMUM_PAYOUT_CENTS (50)

  it("returns requiresManualReview=true when sellerPayout < MINIMUM_PAYOUT_CENTS", () => {
    const result = calculateFeesSync(100, null);
    expect(result.requiresManualReview).toBe(true);
  });

  it("sets sellerPayout to 0 when requiresManualReview", () => {
    const result = calculateFeesSync(100, null);
    expect(result.sellerPayout).toBe(0);
  });

  it("includes manualReviewReason when requiresManualReview", () => {
    const result = calculateFeesSync(100, null);
    expect(result.manualReviewReason).toBeDefined();
    expect(typeof result.manualReviewReason).toBe("string");
    expect(result.manualReviewReason!.length).toBeGreaterThan(0);
    // Should mention the fee amount and manual review
    expect(result.manualReviewReason).toContain("manual review");
  });

  it("does NOT set requiresManualReview for normal amounts", () => {
    // $100 (10000 cents) — well above minimum
    const result = calculateFeesSync(10000, null);
    expect(result.requiresManualReview).toBeUndefined();
    expect(result.manualReviewReason).toBeUndefined();
    expect(result.sellerPayout).toBeGreaterThan(0);
  });
});

// ── Payout worker: tier fee comparisons ─────────────────────────────────────

describe("Fee calculation — tier comparison for payout worker logic", () => {
  it("GOLD tier produces lower platform fee than STANDARD for the same amount", () => {
    const gold = calculateFeesSync(10000, "GOLD");
    const standard = calculateFeesSync(10000, null);

    expect(gold.platformFee).toBeLessThan(standard.platformFee);
    // GOLD rate = 2.5%, STANDARD rate = 3.5%
    expect(gold.platformFeeRate).toBe(0.025);
    expect(standard.platformFeeRate).toBe(0.035);
    // Consequently, GOLD seller receives more
    expect(gold.sellerPayout).toBeGreaterThan(standard.sellerPayout);
  });

  it("SILVER tier produces intermediate platform fee between GOLD and STANDARD", () => {
    const gold = calculateFeesSync(10000, "GOLD");
    const silver = calculateFeesSync(10000, "SILVER");
    const standard = calculateFeesSync(10000, null);

    // SILVER rate = 3.0%, between GOLD (2.5%) and STANDARD (3.5%)
    expect(silver.platformFee).toBeGreaterThan(gold.platformFee);
    expect(silver.platformFee).toBeLessThan(standard.platformFee);
    expect(silver.platformFeeRate).toBe(0.03);
  });
});

// ── getClientIp edge cases ──────────────────────────────────────────────────

describe("getClientIp", () => {
  it("trims whitespace from x-vercel-forwarded-for", () => {
    const headers = new Headers();
    headers.set("x-vercel-forwarded-for", "  203.0.113.50  ");
    expect(getClientIp(headers)).toBe("203.0.113.50");
  });

  it("handles multiple IPs in x-vercel-forwarded-for (takes first)", () => {
    const headers = new Headers();
    headers.set(
      "x-vercel-forwarded-for",
      "203.0.113.50, 10.0.0.1, 192.168.1.1",
    );
    expect(getClientIp(headers)).toBe("203.0.113.50");
  });

  it("prefers x-real-ip over x-vercel-forwarded-for", () => {
    const headers = new Headers();
    headers.set("x-real-ip", "198.51.100.10");
    headers.set("x-vercel-forwarded-for", "203.0.113.50");
    expect(getClientIp(headers)).toBe("198.51.100.10");
  });

  it("prefers cf-connecting-ip over x-vercel-forwarded-for", () => {
    const headers = new Headers();
    headers.set("cf-connecting-ip", "198.51.100.20");
    headers.set("x-vercel-forwarded-for", "203.0.113.50");
    expect(getClientIp(headers)).toBe("198.51.100.20");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");
  });
});
