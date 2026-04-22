// src/test/fee-calculator.test.ts
// ─── Unit tests for src/modules/payments/fee-calculator.ts ─────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only to allow importing in tests
vi.mock("server-only", () => ({}));

// Mock platform-config before importing fee-calculator
const mockGetConfigFloat = vi.fn();
const mockGetConfigInt = vi.fn();

vi.mock("@/lib/platform-config", () => ({
  getConfigFloat: (...args: unknown[]) => mockGetConfigFloat(...args),
  getConfigInt: (...args: unknown[]) => mockGetConfigInt(...args),
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

import {
  calculateFeesSync,
  calculateFees,
  calculateFeesFromBps,
} from "@/modules/payments/fee-calculator";

// ── calculateFeesSync ────────────────────────────────────────────────────────

describe("calculateFeesSync", () => {
  it("calculates Standard tier fees for $100 (10000 cents)", () => {
    const result = calculateFeesSync(10000, null);
    // Stripe: round(10000 * 0.019 + 30) = round(220) = 220
    expect(result.stripeFee).toBe(220);
    // Platform: round(10000 * 0.035) = 350, clamped [50, 5000] = 350
    expect(result.platformFee).toBe(350);
    expect(result.totalFees).toBe(570);
    expect(result.sellerPayout).toBe(9430);
    expect(result.tier).toBe("STANDARD");
  });

  it("uses Gold tier rate (2.5%) for GOLD sellers", () => {
    const result = calculateFeesSync(10000, "GOLD");
    // Platform: round(10000 * 0.025) = 250
    expect(result.platformFee).toBe(250);
    expect(result.tier).toBe("GOLD");
    expect(result.platformFeeRate).toBe(0.025);
  });

  it("uses Silver tier rate (3.0%) for SILVER sellers", () => {
    const result = calculateFeesSync(10000, "SILVER");
    // Platform: round(10000 * 0.03) = 300
    expect(result.platformFee).toBe(300);
    expect(result.tier).toBe("SILVER");
    expect(result.platformFeeRate).toBe(0.03);
  });

  it("uses Standard rate for BRONZE sellers (no discount)", () => {
    const result = calculateFeesSync(10000, "BRONZE");
    expect(result.platformFee).toBe(350);
    expect(result.tier).toBe("STANDARD");
    expect(result.platformFeeRate).toBe(0.035);
  });

  it("clamps platform fee to minimum (50 cents)", () => {
    // Small item: $5 (500 cents)
    const result = calculateFeesSync(500, null);
    // Raw platform fee: round(500 * 0.035) = round(17.5) = 18
    // But minimum is 50 cents, so clamped to 50
    expect(result.platformFee).toBe(50);
  });

  it("clamps platform fee to maximum (5000 cents / $50)", () => {
    // Expensive item: $5000 (500000 cents)
    const result = calculateFeesSync(500000, null);
    // Raw platform fee: round(500000 * 0.035) = 17500
    // But maximum is 5000, so clamped to 5000
    expect(result.platformFee).toBe(5000);
  });

  it("returns all fields in FeeBreakdown", () => {
    const result = calculateFeesSync(10000);
    expect(result).toHaveProperty("grossAmountCents", 10000);
    expect(result).toHaveProperty("stripeFee");
    expect(result).toHaveProperty("platformFee");
    expect(result).toHaveProperty("platformFeeRate");
    expect(result).toHaveProperty("totalFees");
    expect(result).toHaveProperty("sellerPayout");
    expect(result).toHaveProperty("tier");
  });

  it("sellerPayout equals grossAmount minus totalFees", () => {
    const result = calculateFeesSync(7777, "SILVER");
    expect(result.sellerPayout).toBe(
      result.grossAmountCents - result.totalFees,
    );
  });

  it("totalFees equals stripeFee plus platformFee", () => {
    const result = calculateFeesSync(12345, "GOLD");
    expect(result.totalFees).toBe(result.stripeFee + result.platformFee);
  });

  it("defaults to null (Standard) when no tier provided", () => {
    const result = calculateFeesSync(10000);
    expect(result.tier).toBe("STANDARD");
    expect(result.platformFeeRate).toBe(0.035);
  });

  it("uses integer math — all fee amounts are whole numbers", () => {
    const result = calculateFeesSync(9999, "SILVER");
    expect(Number.isInteger(result.stripeFee)).toBe(true);
    expect(Number.isInteger(result.platformFee)).toBe(true);
    expect(Number.isInteger(result.totalFees)).toBe(true);
    expect(Number.isInteger(result.sellerPayout)).toBe(true);
  });
});

// ── calculateFees (async, config-backed) ─────────────────────────────────────

describe("calculateFees", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Return config values matching seed defaults (stored as percentages)
    mockGetConfigFloat.mockImplementation((key: string) => {
      const values: Record<string, number> = {
        "financial.fee.platform_standard_rate": 3.5,
        "financial.fee.platform_silver_rate": 3.0,
        "financial.fee.platform_gold_rate": 2.5,
        "financial.fee.stripe_rate": 1.9,
      };
      return Promise.resolve(values[key] ?? 0);
    });
    mockGetConfigInt.mockImplementation((key: string) => {
      const values: Record<string, number> = {
        "financial.fee.platform_minimum_cents": 50,
        "financial.fee.platform_maximum_cents": 5000,
        "financial.fee.stripe_fixed_cents": 30,
      };
      return Promise.resolve(values[key] ?? 0);
    });
  });

  it("reads fee rates from PlatformConfig", async () => {
    const result = await calculateFees(10000, null);
    expect(mockGetConfigFloat).toHaveBeenCalled();
    expect(mockGetConfigInt).toHaveBeenCalled();
    // Same result as sync with default values
    expect(result.stripeFee).toBe(220);
    expect(result.platformFee).toBe(350);
    expect(result.tier).toBe("STANDARD");
  });

  it("applies Gold tier rate from config", async () => {
    const result = await calculateFees(10000, "GOLD");
    expect(result.platformFee).toBe(250);
    expect(result.tier).toBe("GOLD");
  });

  it("respects custom config values", async () => {
    // Admin changed standard rate to 4%
    mockGetConfigFloat.mockImplementation((key: string) => {
      const values: Record<string, number> = {
        "financial.fee.platform_standard_rate": 4.0,
        "financial.fee.platform_silver_rate": 3.0,
        "financial.fee.platform_gold_rate": 2.5,
        "financial.fee.stripe_rate": 1.9,
      };
      return Promise.resolve(values[key] ?? 0);
    });

    const result = await calculateFees(10000, null);
    // Platform: round(10000 * 0.04) = 400
    expect(result.platformFee).toBe(400);
  });

  it("applies min/max clamps from config", async () => {
    // Admin set minimum to 100 cents
    mockGetConfigInt.mockImplementation((key: string) => {
      const values: Record<string, number> = {
        "financial.fee.platform_minimum_cents": 100,
        "financial.fee.platform_maximum_cents": 5000,
        "financial.fee.stripe_fixed_cents": 30,
      };
      return Promise.resolve(values[key] ?? 0);
    });

    const result = await calculateFees(500, null);
    // Raw: round(500 * 0.035) = 18, but min is 100
    expect(result.platformFee).toBe(100);
  });
});

// ── calculateFeesFromBps (snapshot replay) ───────────────────────────────────

describe("calculateFeesFromBps", () => {
  it("returns correct breakdown for 350 bps (3.5%) on $100", () => {
    const result = calculateFeesFromBps(10000, 350, null);

    // Platform: round(10000 * 0.035) = 350
    expect(result.platformFee).toBe(350);
    expect(result.platformFeeRate).toBe(0.035);
    // Stripe fee uses contractual defaults: 1.9% + 30c
    expect(result.stripeFee).toBe(220);
    expect(result.totalFees).toBe(570);
    expect(result.sellerPayout).toBe(9430);
  });

  it("produces identical output to calculateFeesSync for the default rate", () => {
    const snapshot = calculateFeesFromBps(10000, 350, null);
    const live = calculateFeesSync(10000, null);

    expect(snapshot.platformFee).toBe(live.platformFee);
    expect(snapshot.stripeFee).toBe(live.stripeFee);
    expect(snapshot.sellerPayout).toBe(live.sellerPayout);
    expect(snapshot.totalFees).toBe(live.totalFees);
  });

  it("uses the snapshotted rate regardless of seller tier", () => {
    // Snapshot was taken at 2.5% (GOLD tier at snapshot time).
    // Even if we pass a different tier now, the stored rate wins —
    // that's the whole point of snapshotting.
    const asGold = calculateFeesFromBps(10000, 250, "GOLD");
    const asSilver = calculateFeesFromBps(10000, 250, "SILVER");
    const asStandard = calculateFeesFromBps(10000, 250, null);

    expect(asGold.platformFee).toBe(250);
    expect(asSilver.platformFee).toBe(250);
    expect(asStandard.platformFee).toBe(250);
  });

  it("respects the minimum fee clamp (50 cents)", () => {
    // $5 gross at 3.5% = 18 cents → clamped up to 50
    const result = calculateFeesFromBps(500, 350, null);
    expect(result.platformFee).toBe(50);
  });

  it("respects the maximum fee clamp (5000 cents / $50)", () => {
    // $5000 gross at 3.5% = 17500 cents → clamped down to 5000
    const result = calculateFeesFromBps(500000, 350, null);
    expect(result.platformFee).toBe(5000);
  });

  it("uses integer math — all fee amounts are whole numbers", () => {
    const result = calculateFeesFromBps(9999, 325, "SILVER");
    expect(Number.isInteger(result.stripeFee)).toBe(true);
    expect(Number.isInteger(result.platformFee)).toBe(true);
    expect(Number.isInteger(result.totalFees)).toBe(true);
    expect(Number.isInteger(result.sellerPayout)).toBe(true);
  });

  it("flags requiresManualReview when fees exceed seller payout", () => {
    // $1 gross at 3.5% — stripe fee alone is 49c, platform min 50c,
    // total 99c > gross 100c → seller would receive 1c, sub-minimum
    const result = calculateFeesFromBps(100, 350, null);
    expect(result.requiresManualReview).toBe(true);
    expect(result.sellerPayout).toBe(0);
  });

  it("round-trip: basis points → decimal rate preserves the value", () => {
    // 350 bps → 0.035 decimal → same fee as hardcoded 3.5%
    const result = calculateFeesFromBps(10000, 350, null);
    expect(result.platformFeeRate).toBe(0.035);
  });
});
