// src/test/trust-score.test.ts
// ─── Seller Trust Score + Response Metrics ──────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock seller repository ──────────────────────────────────────────────────
const mockFindForTrustProfile = vi.fn();
const mockGroupOrdersByStatus = vi.fn();
const mockAggregateSellerReviews = vi.fn();
const mockCountRecentCompletedSales = vi.fn();
const mockFindMessageThreadsForMetrics = vi.fn();
const mockUpdateResponseMetrics = vi.fn();

vi.mock("@/modules/sellers/seller.repository", () => ({
  sellerRepository: {
    findForTrustProfile: (...a: unknown[]) => mockFindForTrustProfile(...a),
    groupOrdersByStatus: (...a: unknown[]) => mockGroupOrdersByStatus(...a),
    aggregateSellerReviews: (...a: unknown[]) =>
      mockAggregateSellerReviews(...a),
    countRecentCompletedSales: (...a: unknown[]) =>
      mockCountRecentCompletedSales(...a),
    findMessageThreadsForMetrics: (...a: unknown[]) =>
      mockFindMessageThreadsForMetrics(...a),
    updateResponseMetrics: (...a: unknown[]) => mockUpdateResponseMetrics(...a),
  },
}));

// ── Mock seller tiers ───────────────────────────────────────────────────────
vi.mock("@/lib/seller-tiers.server", () => ({
  calculateSellerTier: vi.fn().mockResolvedValue("SILVER"),
}));

// ── Mock next/cache (unstable_cache passthrough) ────────────────────────────
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { getSellerTrustProfile } from "@/modules/sellers/trust-score.service";
import {
  updateSellerResponseMetrics,
  getResponseLabel,
  getResponseColour,
} from "@/modules/sellers/response-metrics.service";

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// Trust Score Service
// ═══════════════════════════════════════════════════════════════════════════

describe("getSellerTrustProfile", () => {
  it("returns zero profile when user not found", async () => {
    mockFindForTrustProfile.mockResolvedValue(null);
    mockGroupOrdersByStatus.mockResolvedValue([]);
    mockAggregateSellerReviews.mockResolvedValue({
      _avg: { rating: null },
      _count: { id: 0 },
    });
    mockCountRecentCompletedSales.mockResolvedValue(0);

    const profile = await getSellerTrustProfile("nonexistent");
    expect(profile.trustScore).toBe(0);
    expect(profile.totalOrders).toBe(0);
    expect(profile.data.avgRating).toBe(0);
  });

  it("calculates trust score for an established seller", async () => {
    mockFindForTrustProfile.mockResolvedValue({
      createdAt: new Date("2024-01-01"),
      isVerifiedSeller: true,
      idVerified: true,
      responseRate: 95,
      sellerTierOverride: null,
    });
    mockGroupOrdersByStatus.mockResolvedValue([
      { status: "COMPLETED", _count: { id: 50 } },
      { status: "DISPUTED", _count: { id: 2 } },
      { status: "PAYMENT_HELD", _count: { id: 3 } },
    ]);
    mockAggregateSellerReviews.mockResolvedValue({
      _avg: { rating: 45 }, // 4.5 out of 5 (stored as 1-50)
      _count: { id: 30 },
    });
    mockCountRecentCompletedSales.mockResolvedValue(50);

    const profile = await getSellerTrustProfile("seller-1");

    expect(profile.trustScore).toBeGreaterThan(50);
    expect(profile.data.avgRating).toBeCloseTo(4.5, 1);
    expect(profile.data.reviewCount).toBe(30);
    expect(profile.completedSales).toBe(50);
    expect(profile.totalOrders).toBe(55);
    expect(profile.data.verifiedSeller).toBe(true);
  });

  it("sets 100% completion rate when no orders exist", async () => {
    mockFindForTrustProfile.mockResolvedValue({
      createdAt: new Date(),
      isVerifiedSeller: false,
      idVerified: false,
      responseRate: null,
      sellerTierOverride: null,
    });
    mockGroupOrdersByStatus.mockResolvedValue([]);
    mockAggregateSellerReviews.mockResolvedValue({
      _avg: { rating: null },
      _count: { id: 0 },
    });
    mockCountRecentCompletedSales.mockResolvedValue(0);

    const profile = await getSellerTrustProfile("new-seller");
    expect(profile.data.completionRate).toBe(100);
    expect(profile.data.disputeRate).toBe(0);
  });

  it("penalises high dispute rate", async () => {
    mockFindForTrustProfile.mockResolvedValue({
      createdAt: new Date("2024-01-01"),
      isVerifiedSeller: false,
      idVerified: false,
      responseRate: 50,
      sellerTierOverride: null,
    });
    mockGroupOrdersByStatus.mockResolvedValue([
      { status: "COMPLETED", _count: { id: 5 } },
      { status: "DISPUTED", _count: { id: 5 } },
    ]);
    mockAggregateSellerReviews.mockResolvedValue({
      _avg: { rating: 30 },
      _count: { id: 5 },
    });
    mockCountRecentCompletedSales.mockResolvedValue(5);

    const profile = await getSellerTrustProfile("bad-seller");
    // 50% dispute rate → heavy penalty
    expect(profile.data.disputeRate).toBeCloseTo(0.5, 2);
    expect(profile.trustScore).toBeLessThan(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Response Metrics Service
// ═══════════════════════════════════════════════════════════════════════════

describe("updateSellerResponseMetrics", () => {
  const NOW = Date.now();
  const HOUR = 60 * 60 * 1000;

  function thread(msgs: { senderId: string; hoursAgo: number }[]) {
    return {
      messages: msgs.map((m) => ({
        senderId: m.senderId,
        createdAt: new Date(NOW - m.hoursAgo * HOUR),
      })),
    };
  }

  it("calculates average response time from message threads", async () => {
    // 3 threads, seller replies in 1h, 2h, 3h
    mockFindMessageThreadsForMetrics.mockResolvedValue([
      thread([
        { senderId: "buyer-1", hoursAgo: 10 },
        { senderId: "seller-1", hoursAgo: 9 },
      ]),
      thread([
        { senderId: "buyer-2", hoursAgo: 8 },
        { senderId: "seller-1", hoursAgo: 6 },
      ]),
      thread([
        { senderId: "buyer-3", hoursAgo: 6 },
        { senderId: "seller-1", hoursAgo: 3 },
      ]),
    ]);

    await updateSellerResponseMetrics("seller-1");

    expect(mockUpdateResponseMetrics).toHaveBeenCalledOnce();
    const [, avgMin, rate] = mockUpdateResponseMetrics.mock.calls[0]!;
    expect(avgMin).toBeGreaterThan(0);
    expect(rate).toBe(100); // All replies within 24h
  });

  it("skips update when fewer than 3 reply samples", async () => {
    mockFindMessageThreadsForMetrics.mockResolvedValue([
      thread([
        { senderId: "buyer-1", hoursAgo: 5 },
        { senderId: "seller-1", hoursAgo: 4 },
      ]),
    ]);

    await updateSellerResponseMetrics("seller-1");
    expect(mockUpdateResponseMetrics).not.toHaveBeenCalled();
  });

  it("skips threads with fewer than 2 messages", async () => {
    mockFindMessageThreadsForMetrics.mockResolvedValue([
      thread([{ senderId: "buyer-1", hoursAgo: 5 }]),
      thread([{ senderId: "buyer-2", hoursAgo: 4 }]),
      thread([{ senderId: "buyer-3", hoursAgo: 3 }]),
    ]);

    await updateSellerResponseMetrics("seller-1");
    expect(mockUpdateResponseMetrics).not.toHaveBeenCalled();
  });

  it("handles errors silently (fire-and-forget)", async () => {
    mockFindMessageThreadsForMetrics.mockRejectedValue(new Error("DB timeout"));

    // Should not throw
    await expect(
      updateSellerResponseMetrics("seller-1"),
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Response label/colour helpers
// ═══════════════════════════════════════════════════════════════════════════

describe("getResponseLabel", () => {
  it('returns "Replies within 1 hour" for ≤ 60 minutes', () => {
    expect(getResponseLabel(30)).toBe("Replies within 1 hour");
    expect(getResponseLabel(60)).toBe("Replies within 1 hour");
  });

  it('returns "Replies within a few hours" for 61-240 minutes', () => {
    expect(getResponseLabel(120)).toBe("Replies within a few hours");
  });

  it('returns "Replies within a day" for 241-1440 minutes', () => {
    expect(getResponseLabel(720)).toBe("Replies within a day");
  });

  it('returns "Slow to respond" for > 1440 minutes', () => {
    expect(getResponseLabel(2880)).toBe("Slow to respond");
  });

  it('returns "New seller" for null', () => {
    expect(getResponseLabel(null)).toBe("New seller");
  });
});

describe("getResponseColour", () => {
  it("returns emerald for fast responders", () => {
    expect(getResponseColour(30)).toContain("emerald");
  });

  it("returns amber for moderate responders", () => {
    expect(getResponseColour(120)).toContain("amber");
  });

  it("returns red for slow responders", () => {
    expect(getResponseColour(2880)).toContain("red");
  });

  it("returns grey for null (new seller)", () => {
    expect(getResponseColour(null)).toContain("9E9A91");
  });
});
