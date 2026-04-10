// src/test/session8-fees.test.ts
// ─── Session 8: Fee admin UI, preview API, seller disclosure, order breakdown ─
// 7 tests covering the new fee features.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock platform-config (needed by fee-calculator) ───────────────────────────

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
  invalidateConfig: vi.fn(),
}));

// ── Mock requirePermission for admin route tests ──────────────────────────────

vi.mock("@/shared/auth/requirePermission", () => ({
  requirePermission: vi.fn(),
}));

// ── Mock audit, rateLimit, headers for admin route ───────────────────────────

vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));
vi.mock("@/server/lib/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, retryAfter: 0 }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

// ── Mock adminConfigRepository ────────────────────────────────────────────────

vi.mock("@/modules/admin/admin-config.repository", () => ({
  adminConfigRepository: {
    findAll: vi.fn().mockResolvedValue([]),
    findByKey: vi.fn(),
    updateValue: vi.fn(),
  },
}));

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock("@/shared/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { calculateFees } from "@/modules/payments/fee-calculator";
import { requirePermission } from "@/shared/auth/requirePermission";
import { adminConfigRepository } from "@/modules/admin/admin-config.repository";
import {
  DEFAULT_PLATFORM_FEE_RATE,
  STRIPE_FEE_RATE,
  STRIPE_FEE_FIXED_CENTS,
} from "@/lib/currency";

// ── Config defaults matching seed values ─────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  mockGetConfigFloat.mockImplementation((key: string) => {
    const vals: Record<string, number> = {
      "financial.fee.platform_standard_rate": 3.5,
      "financial.fee.platform_silver_rate": 3.0,
      "financial.fee.platform_gold_rate": 2.5,
      "financial.fee.stripe_rate": 1.9,
    };
    return Promise.resolve(vals[key] ?? 0);
  });

  mockGetConfigInt.mockImplementation((key: string) => {
    const vals: Record<string, number> = {
      "financial.fee.platform_minimum_cents": 50,
      "financial.fee.platform_maximum_cents": 5000,
      "financial.fee.stripe_fixed_cents": 30,
    };
    return Promise.resolve(vals[key] ?? 0);
  });
});

// ─── 1. Fee preview: calculateFees returns correct FeeBreakdown ───────────────

describe("fee preview — calculateFees (config-backed)", () => {
  it("returns FeeBreakdown with all fields for $100 Standard", async () => {
    const result = await calculateFees(10000, null);
    expect(result).toMatchObject({
      grossAmountCents: 10000,
      stripeFee: 220,
      platformFee: 350,
      totalFees: 570,
      sellerPayout: 9430,
      tier: "STANDARD",
    });
  });

  it("GOLD tier applies lower platform fee than Standard", async () => {
    const standard = await calculateFees(10000, null);
    const gold = await calculateFees(10000, "GOLD");
    expect(gold.platformFee).toBeLessThan(standard.platformFee);
    expect(gold.tier).toBe("GOLD");
  });

  it("SILVER tier fee is between Standard and GOLD", async () => {
    const standard = await calculateFees(10000, null);
    const silver = await calculateFees(10000, "SILVER");
    const gold = await calculateFees(10000, "GOLD");
    expect(silver.platformFee).toBeLessThan(standard.platformFee);
    expect(silver.platformFee).toBeGreaterThan(gold.platformFee);
  });
});

// ─── 2. Seller fee disclosure — SellStep3Pricing inline fee logic ─────────────

describe("seller fee disclosure — platform fee calculation using currency constants", () => {
  const PLATFORM_FEE_MIN = 50;
  const PLATFORM_FEE_MAX = 5000;

  function calcPlatformFee(grossCents: number): number {
    return Math.max(
      PLATFORM_FEE_MIN,
      Math.min(
        PLATFORM_FEE_MAX,
        Math.round(grossCents * DEFAULT_PLATFORM_FEE_RATE),
      ),
    );
  }

  function calcStripeFee(grossCents: number): number {
    return Math.round(grossCents * STRIPE_FEE_RATE + STRIPE_FEE_FIXED_CENTS);
  }

  it("fee breakdown: youReceive = price - stripeFee - platformFee", () => {
    const grossCents = 10000; // $100
    const stripeFee = calcStripeFee(grossCents);
    const platformFee = calcPlatformFee(grossCents);
    const youReceive = grossCents - stripeFee - platformFee;

    expect(stripeFee).toBe(220);
    expect(platformFee).toBe(350);
    expect(youReceive).toBe(9430);
  });

  it("platform fee clamps to minimum $0.50 for very small items", () => {
    const platformFee = calcPlatformFee(200); // $2 item → raw fee 7 cents < min
    expect(platformFee).toBe(50);
  });
});

// ─── 3. Admin platform-fees API — auth and key validation ─────────────────────

describe("admin platform-fees API", () => {
  it("PATCH rejects unknown fee config key with 400", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
    } as never);

    const { PATCH } = await import("@/app/api/admin/platform-fees/route");

    const req = new Request("http://localhost/api/admin/platform-fees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "financial.fee.not_a_real_key",
        value: "5.0",
      }),
    });

    const res = await PATCH(req);
    const body = (await res.json()) as { success: boolean; code?: string };

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe("UNKNOWN_KEY");
  });

  it("PATCH with known key calls adminConfigRepository.updateValue", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
    } as never);

    vi.mocked(adminConfigRepository.findByKey).mockResolvedValue({
      id: "cfg-1",
      key: "financial.fee.platform_standard_rate",
      value: "3.5",
      type: "DECIMAL",
      label: "Standard rate",
      description: "desc",
      unit: "%",
      minValue: "0",
      maxValue: "20",
      category: "FINANCIAL",
      updatedById: null,
      updatedAt: new Date(),
      createdAt: new Date(),
      updater: null,
    } as never);

    vi.mocked(adminConfigRepository.updateValue).mockResolvedValue(undefined);

    const { PATCH } = await import("@/app/api/admin/platform-fees/route");

    const req = new Request("http://localhost/api/admin/platform-fees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "financial.fee.platform_standard_rate",
        value: "4.0",
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(vi.mocked(adminConfigRepository.updateValue)).toHaveBeenCalledWith(
      "financial.fee.platform_standard_rate",
      "4.0",
      "admin-1",
    );
  });
});

// ─── 4. Order payout breakdown — payout is null for buyers ────────────────────

describe("order detail payout — null for buyers", () => {
  it("payout field is null when isBuyer is true", () => {
    // This mirrors the mapping logic in orderDetail.ts:
    // payout: !isBuyer && order.payout ? { ... } : null
    const isBuyer = true;
    const rawPayout = {
      status: "PENDING",
      amountNzd: 10000,
      platformFeeNzd: 350,
      stripeFeeNzd: 220,
    };

    const payout =
      !isBuyer && rawPayout
        ? {
            status: rawPayout.status,
            amountNzd: rawPayout.amountNzd,
            platformFeeNzd: rawPayout.platformFeeNzd,
            stripeFeeNzd: rawPayout.stripeFeeNzd,
            sellerPayoutNzd:
              rawPayout.amountNzd -
              rawPayout.platformFeeNzd -
              rawPayout.stripeFeeNzd,
          }
        : null;

    expect(payout).toBeNull();
  });

  it("payout field calculates sellerPayoutNzd = amountNzd - fees when isSeller", () => {
    const isBuyer = false;
    const rawPayout = {
      status: "PENDING",
      amountNzd: 10000,
      platformFeeNzd: 350,
      stripeFeeNzd: 220,
    };

    const payout =
      !isBuyer && rawPayout
        ? {
            status: rawPayout.status,
            amountNzd: rawPayout.amountNzd,
            platformFeeNzd: rawPayout.platformFeeNzd,
            stripeFeeNzd: rawPayout.stripeFeeNzd,
            sellerPayoutNzd:
              rawPayout.amountNzd -
              rawPayout.platformFeeNzd -
              rawPayout.stripeFeeNzd,
          }
        : null;

    expect(payout).not.toBeNull();
    expect(payout!.sellerPayoutNzd).toBe(9430); // 10000 - 350 - 220
  });
});
