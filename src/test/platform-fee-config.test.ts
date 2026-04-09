// src/test/platform-fee-config.test.ts
// ─── Tests for platform fee config keys, defaults, and seed structure ───────

import { describe, it, expect } from "vitest";
import { CONFIG_KEYS } from "@/lib/platform-config/config-keys";
import { CONFIG_DEFAULTS } from "@/lib/platform-config/config-defaults";

// ── Fee config keys exist ────────────────────────────────────────────────────

describe("platform fee config keys", () => {
  it("defines PLATFORM_FEE_STANDARD_RATE key", () => {
    expect(CONFIG_KEYS.PLATFORM_FEE_STANDARD_RATE).toBe(
      "financial.fee.platform_standard_rate",
    );
  });

  it("defines PLATFORM_FEE_SILVER_RATE key", () => {
    expect(CONFIG_KEYS.PLATFORM_FEE_SILVER_RATE).toBe(
      "financial.fee.platform_silver_rate",
    );
  });

  it("defines PLATFORM_FEE_GOLD_RATE key", () => {
    expect(CONFIG_KEYS.PLATFORM_FEE_GOLD_RATE).toBe(
      "financial.fee.platform_gold_rate",
    );
  });

  it("defines PLATFORM_FEE_MINIMUM_CENTS key", () => {
    expect(CONFIG_KEYS.PLATFORM_FEE_MINIMUM_CENTS).toBe(
      "financial.fee.platform_minimum_cents",
    );
  });

  it("defines PLATFORM_FEE_MAXIMUM_CENTS key", () => {
    expect(CONFIG_KEYS.PLATFORM_FEE_MAXIMUM_CENTS).toBe(
      "financial.fee.platform_maximum_cents",
    );
  });

  it("defines STRIPE_FEE_RATE key", () => {
    expect(CONFIG_KEYS.STRIPE_FEE_RATE).toBe("financial.fee.stripe_rate");
  });

  it("defines STRIPE_FEE_FIXED_CENTS key", () => {
    expect(CONFIG_KEYS.STRIPE_FEE_FIXED_CENTS).toBe(
      "financial.fee.stripe_fixed_cents",
    );
  });
});

// ── Fee config defaults ──────────────────────────────────────────────────────

describe("platform fee config defaults", () => {
  it("standard rate default is 3.5%", () => {
    expect(CONFIG_DEFAULTS[CONFIG_KEYS.PLATFORM_FEE_STANDARD_RATE]).toBe("3.5");
  });

  it("silver rate default is lower than standard", () => {
    const standard = parseFloat(
      CONFIG_DEFAULTS[CONFIG_KEYS.PLATFORM_FEE_STANDARD_RATE],
    );
    const silver = parseFloat(
      CONFIG_DEFAULTS[CONFIG_KEYS.PLATFORM_FEE_SILVER_RATE],
    );
    expect(silver).toBeLessThan(standard);
  });

  it("gold rate default is lower than silver", () => {
    const silver = parseFloat(
      CONFIG_DEFAULTS[CONFIG_KEYS.PLATFORM_FEE_SILVER_RATE],
    );
    const gold = parseFloat(
      CONFIG_DEFAULTS[CONFIG_KEYS.PLATFORM_FEE_GOLD_RATE],
    );
    expect(gold).toBeLessThan(silver);
  });
});
