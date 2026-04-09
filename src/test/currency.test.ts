// src/test/currency.test.ts
// ─── Unit tests for src/lib/currency.ts ──────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  toCents,
  fromCents,
  formatCentsAsNzd,
  formatNzd,
  calculateStripeFee,
  STRIPE_FEE_RATE,
  STRIPE_FEE_FIXED_CENTS,
  DEFAULT_PLATFORM_FEE_RATE,
} from "@/lib/currency";

// ── toCents ───────────────────────────────────────────────────────────────────

describe("toCents", () => {
  it("toCents(50) === 5000", () => {
    expect(toCents(50)).toBe(5000);
  });

  it("toCents(50.99) === 5099 (correct rounding)", () => {
    expect(toCents(50.99)).toBe(5099);
  });

  it("toCents(50.999) === 5100 (Math.round rounds up at .5)", () => {
    expect(toCents(50.999)).toBe(5100);
  });

  it("toCents(0) === 0", () => {
    expect(toCents(0)).toBe(0);
  });

  it("toCents rounds up at 0.5 — not floor", () => {
    // 0.505 * 100 = 50.5 → Math.round → 51 (floor would give 50)
    expect(toCents(0.505)).toBe(51);
  });
});

// ── fromCents ─────────────────────────────────────────────────────────────────

describe("fromCents", () => {
  it("fromCents(5099) === 50.99", () => {
    expect(fromCents(5099)).toBe(50.99);
  });

  it("fromCents(5000) === 50", () => {
    expect(fromCents(5000)).toBe(50);
  });

  it("fromCents(0) === 0", () => {
    expect(fromCents(0)).toBe(0);
  });

  it("round-trips: fromCents(toCents(x)) === x for whole cents", () => {
    expect(fromCents(toCents(99.99))).toBe(99.99);
  });
});

// ── formatCentsAsNzd ──────────────────────────────────────────────────────────

describe("formatCentsAsNzd", () => {
  it("formatCentsAsNzd(5099) === '$50.99 NZD'", () => {
    expect(formatCentsAsNzd(5099)).toBe("$50.99 NZD");
  });

  it("formatCentsAsNzd(5000) === '$50.00 NZD'", () => {
    expect(formatCentsAsNzd(5000)).toBe("$50.00 NZD");
  });

  it("formatCentsAsNzd(0) === '$0.00 NZD'", () => {
    expect(formatCentsAsNzd(0)).toBe("$0.00 NZD");
  });

  it("always includes exactly 2 decimal places", () => {
    expect(formatCentsAsNzd(100)).toBe("$1.00 NZD");
    expect(formatCentsAsNzd(101)).toBe("$1.01 NZD");
  });
});

// ── formatNzd ─────────────────────────────────────────────────────────────────

describe("formatNzd", () => {
  it("returns a string starting with $ for positive values", () => {
    const result = formatNzd(5099);
    expect(result).toMatch(/^\$/);
  });

  it("includes the dollar amount for 5099 cents", () => {
    const result = formatNzd(5099);
    expect(result).toContain("50.99");
  });
});

// ── fee calculations ──────────────────────────────────────────────────────────

describe("calculateStripeFee", () => {
  it("calculateStripeFee(10000) uses the correct formula", () => {
    // 10000 * 0.019 + 30 = 190 + 30 = 220
    expect(calculateStripeFee(10000)).toBe(220);
  });

  it("uses STRIPE_FEE_RATE and STRIPE_FEE_FIXED_CENTS constants", () => {
    const manual = Math.round(10000 * STRIPE_FEE_RATE + STRIPE_FEE_FIXED_CENTS);
    expect(calculateStripeFee(10000)).toBe(manual);
  });

  it("STRIPE_FEE_RATE is 0.019 (1.9%)", () => {
    expect(STRIPE_FEE_RATE).toBe(0.019);
  });

  it("STRIPE_FEE_FIXED_CENTS is 30 (30 cents)", () => {
    expect(STRIPE_FEE_FIXED_CENTS).toBe(30);
  });
});

describe("DEFAULT_PLATFORM_FEE_RATE", () => {
  it("DEFAULT_PLATFORM_FEE_RATE is 0.035 (3.5%)", () => {
    expect(DEFAULT_PLATFORM_FEE_RATE).toBe(0.035);
  });
});
