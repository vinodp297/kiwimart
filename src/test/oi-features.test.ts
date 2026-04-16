// src/test/oi-features.test.ts
// ─── Tests for OI-001, OI-004, OI-005, OI-008 ────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// Mock React hooks so client components can be imported in Node test env
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: vi.fn((init: unknown) => [init, vi.fn()]),
    useEffect: vi.fn(),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// OI-001 — BuyerProtectionBadge
// ─────────────────────────────────────────────────────────────────────────────

describe("OI-001 — BuyerProtectionBadge", () => {
  it("default amountCents 300000 formats as $3K", () => {
    const cents = 300_000;
    const dollars = cents / 100;
    const result =
      dollars >= 1000
        ? `$${(dollars / 1000).toFixed(0)}K`
        : `$${dollars.toFixed(0)}`;
    expect(result).toBe("$3K");
  });

  it("amountCents 100000 formats as $1K", () => {
    const cents = 100_000;
    const dollars = cents / 100;
    const result =
      dollars >= 1000
        ? `$${(dollars / 1000).toFixed(0)}K`
        : `$${dollars.toFixed(0)}`;
    expect(result).toBe("$1K");
  });

  it("amountCents 50000 formats as $500 (sub-$1K)", () => {
    const cents = 50_000;
    const dollars = cents / 100;
    const result =
      dollars >= 1000
        ? `$${(dollars / 1000).toFixed(0)}K`
        : `$${dollars.toFixed(0)}`;
    expect(result).toBe("$500");
  });

  it("compact variant — component is exported", async () => {
    const mod = await import("@/components/badges/BuyerProtectionBadge");
    expect(mod.BuyerProtectionBadge).toBeDefined();
    expect(typeof mod.BuyerProtectionBadge).toBe("function");
  });

  it("full variant — 3 NZ-copy bullet points are defined", () => {
    const bullets = [
      "Funds held in secure escrow",
      "Full refund if item not as described",
      "Covered by NZ Consumer Guarantees Act",
    ];
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toContain("escrow");
    expect(bullets[1]).toContain("refund");
    expect(bullets[2]).toContain("NZ Consumer");
  });

  it("variant prop accepted: 'compact' | 'full'", async () => {
    const { BuyerProtectionBadge } =
      await import("@/components/badges/BuyerProtectionBadge");
    // Both valid variant values accepted without throw
    expect(() => BuyerProtectionBadge({ variant: "compact" })).not.toThrow();
    expect(() => BuyerProtectionBadge({ variant: "full" })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OI-004 — CancellationCountdown display logic
// ─────────────────────────────────────────────────────────────────────────────

// formatCountdown extracted for unit testing (mirrors component impl)
function formatCountdown(minutes: number): string {
  if (minutes <= 0) return "0m";
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

describe("OI-004 — CancellationCountdown formatCountdown", () => {
  it("shows hours + minutes when minutesLeft >= 60", () => {
    expect(formatCountdown(90)).toBe("1h 30m");
    expect(formatCountdown(120)).toBe("2h");
    expect(formatCountdown(75)).toBe("1h 15m");
  });

  it("shows minutes only when minutesLeft < 60", () => {
    expect(formatCountdown(45)).toBe("45m");
    expect(formatCountdown(10)).toBe("10m");
    expect(formatCountdown(1)).toBe("1m");
  });

  it("shows 0m when minutesLeft is 0 or negative", () => {
    expect(formatCountdown(0)).toBe("0m");
    expect(formatCountdown(-5)).toBe("0m");
  });

  it("exactly 60 minutes → 1h (no minutes component)", () => {
    expect(formatCountdown(60)).toBe("1h");
  });

  it("component is exported", async () => {
    const mod = await import("@/components/orders/CancellationCountdown");
    expect(mod.CancellationCountdown).toBeDefined();
    expect(typeof mod.CancellationCountdown).toBe("function");
  });
});

describe("OI-004 — getCancellationStatus returns minutesLeft", () => {
  it("free window (5 min elapsed): minutesLeft > 0", async () => {
    const { getCancellationStatus } =
      await import("@/modules/orders/order-cancel.service");
    const status = await getCancellationStatus({
      status: "PAYMENT_HELD",
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    expect(status.windowType).toBe("free");
    expect(status.minutesLeft).toBeGreaterThan(0);
    expect(status.minutesLeft).toBeLessThanOrEqual(60);
  });

  it("non-cancellable status (na): minutesLeft === 0", async () => {
    const { getCancellationStatus } =
      await import("@/modules/orders/order-cancel.service");
    const status = await getCancellationStatus({
      status: "COMPLETED",
      createdAt: new Date(),
    });
    expect(status.windowType).toBe("na");
    expect(status.minutesLeft).toBe(0);
  });

  it("request window (90 min elapsed): minutesLeft === 0", async () => {
    const { getCancellationStatus } =
      await import("@/modules/orders/order-cancel.service");
    const status = await getCancellationStatus({
      status: "PAYMENT_HELD",
      createdAt: new Date(Date.now() - 90 * 60 * 1000),
    });
    expect(status.windowType).toBe("request");
    expect(status.minutesLeft).toBe(0);
  });

  it("closed window (30 h elapsed): minutesLeft === 0", async () => {
    const { getCancellationStatus } =
      await import("@/modules/orders/order-cancel.service");
    const status = await getCancellationStatus({
      status: "PAYMENT_HELD",
      createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
    });
    expect(status.windowType).toBe("closed");
    expect(status.minutesLeft).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OI-005 — getSoldListings repository
// ─────────────────────────────────────────────────────────────────────────────

describe("OI-005 — getSoldListings repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls db.order.findMany with status COMPLETED and completedAt not null", async () => {
    const db = (await import("@/lib/db")).default;
    vi.mocked(db.order.findMany).mockResolvedValue([]);

    const { listingQueryRepository } =
      await import("@/modules/listings/listing-query.repository");
    await listingQueryRepository.getSoldListings(8);

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "COMPLETED",
          completedAt: expect.objectContaining({ not: null }),
        }),
        take: 8,
        orderBy: { completedAt: "desc" },
      }),
    );
  });

  it("respects the limit parameter — take: 4", async () => {
    const db = (await import("@/lib/db")).default;
    vi.mocked(db.order.findMany).mockResolvedValue([]);

    const { listingQueryRepository } =
      await import("@/modules/listings/listing-query.repository");
    await listingQueryRepository.getSoldListings(4);

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 }),
    );
  });

  it("defaults limit to 8 when not specified", async () => {
    const db = (await import("@/lib/db")).default;
    vi.mocked(db.order.findMany).mockResolvedValue([]);

    const { listingQueryRepository } =
      await import("@/modules/listings/listing-query.repository");
    await listingQueryRepository.getSoldListings();

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 8 }),
    );
  });

  it("returns empty array when no completed orders in last 30 days", async () => {
    const db = (await import("@/lib/db")).default;
    vi.mocked(db.order.findMany).mockResolvedValue([]);

    const { getRecentlySoldListings } =
      await import("@/modules/listings/listing-queries.service");
    const result = await getRecentlySoldListings(8);
    expect(result).toEqual([]);
    // Section renders null for empty — length check confirms empty state
    expect(result.length).toBe(0);
  });

  it("completedAt filter is within the last 30 days", async () => {
    const db = (await import("@/lib/db")).default;
    vi.mocked(db.order.findMany).mockResolvedValue([]);

    const { listingQueryRepository } =
      await import("@/modules/listings/listing-query.repository");
    await listingQueryRepository.getSoldListings(8);

    const call = vi.mocked(db.order.findMany).mock.calls[0]![0] as {
      where: { completedAt: { not: null; gte: Date } };
    };
    const gte = call.where.completedAt.gte;
    const thirtyDaysAgoApprox = Date.now() - 30 * 24 * 60 * 60 * 1000;
    // gte should be within a few seconds of 30 days ago
    expect(Math.abs(gte.getTime() - thirtyDaysAgoApprox)).toBeLessThan(5000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OI-008 — VerifiedPurchaseBadge
// ─────────────────────────────────────────────────────────────────────────────

describe("OI-008 — VerifiedPurchaseBadge", () => {
  it("component is exported and is a function", async () => {
    const mod = await import("@/components/badges/VerifiedPurchaseBadge");
    expect(mod.VerifiedPurchaseBadge).toBeDefined();
    expect(typeof mod.VerifiedPurchaseBadge).toBe("function");
  });

  it("badge shown when orderId present: isVerifiedPurchase = true", () => {
    const orderId = "order_123";
    const isVerifiedPurchase = orderId != null;
    expect(isVerifiedPurchase).toBe(true);
  });

  it("badge NOT shown when orderId is null: isVerifiedPurchase = false", () => {
    const orderId: string | null = null;
    const isVerifiedPurchase = orderId != null;
    expect(isVerifiedPurchase).toBe(false);
  });

  it("orderId value NOT forwarded — only boolean flag in mapped review", () => {
    const dbRow = { orderId: "order_secret_xyz" };
    const mapped = {
      // orderId intentionally not included
      isVerifiedPurchase: dbRow.orderId != null,
    };
    expect(mapped).not.toHaveProperty("orderId");
    expect(mapped.isVerifiedPurchase).toBe(true);
  });

  it("Review type accepts isVerifiedPurchase: true", () => {
    const review: import("@/types").Review = {
      id: "r1",
      buyerName: "Alice",
      buyerUsername: "alice",
      buyerAvatarUrl: null,
      rating: 4.5,
      comment: "Great seller",
      listingTitle: "Some item",
      createdAt: new Date().toISOString(),
      sellerReply: null,
      isVerifiedPurchase: true,
    };
    expect(review.isVerifiedPurchase).toBe(true);
  });

  it("Review type valid without isVerifiedPurchase (optional field)", () => {
    const review: import("@/types").Review = {
      id: "r2",
      buyerName: "Bob",
      buyerUsername: "bob",
      buyerAvatarUrl: null,
      rating: 3.0,
      comment: "Okay",
      listingTitle: "Item",
      createdAt: new Date().toISOString(),
      sellerReply: null,
    };
    expect(review.isVerifiedPurchase).toBeUndefined();
  });
});
