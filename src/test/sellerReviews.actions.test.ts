// src/test/sellerReviews.actions.test.ts
// ─── Tests: Seller Reviews Server Action ────────────────────────────────────
// Thin wrapper — verifies auth gate, delegation to reviewService, and safe
// error handling for the fetchSellerReviews action.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock review service ───────────────────────────────────────────────────────
const mockFetchSellerReviews = vi.fn();
vi.mock("@/modules/reviews/review.service", () => ({
  reviewService: {
    fetchSellerReviews: (...args: unknown[]) => mockFetchSellerReviews(...args),
  },
}));

// ── Lazy import ──────────────────────────────────────────────────────────────
const { fetchSellerReviews } = await import("@/server/actions/sellerReviews");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER = { id: "user_seller", email: "s@test.com", isAdmin: false };

const sampleReview = {
  id: "rev_1",
  buyerName: "Alice",
  rating: 5,
  comment: "Fast shipping, excellent item.",
  listingTitle: "Vintage Camera",
  createdAt: "2026-04-01T10:00:00.000Z",
  sellerReply: null,
  tags: ["fast_shipping"],
};

// ─────────────────────────────────────────────────────────────────────────────
// fetchSellerReviews
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchSellerReviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockFetchSellerReviews.mockResolvedValue([sampleReview]);
  });

  it("unauthenticated → returns safe error and does not query reviews", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await fetchSellerReviews();

    expect(result.success).toBe(false);
    expect(mockFetchSellerReviews).not.toHaveBeenCalled();
  });

  it("happy path → returns service payload unchanged", async () => {
    const result = await fetchSellerReviews();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([sampleReview]);
    }
  });

  it("scopes lookup to authenticated user id", async () => {
    await fetchSellerReviews();

    expect(mockFetchSellerReviews).toHaveBeenCalledWith(TEST_USER.id);
  });

  it("different user id → service called with that id", async () => {
    mockRequireUser.mockResolvedValueOnce({
      ...TEST_USER,
      id: "user_other_seller",
    });

    await fetchSellerReviews();

    expect(mockFetchSellerReviews).toHaveBeenCalledWith("user_other_seller");
  });

  it("empty review list → returns success with empty array", async () => {
    mockFetchSellerReviews.mockResolvedValueOnce([]);

    const result = await fetchSellerReviews();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it("service throws → returns safe fallback error (no leak)", async () => {
    mockFetchSellerReviews.mockRejectedValueOnce(
      new Error("ECONNREFUSED postgres"),
    );

    const result = await fetchSellerReviews();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
      expect(result.error).not.toMatch(/ECONNREFUSED|postgres/);
    }
  });
});
