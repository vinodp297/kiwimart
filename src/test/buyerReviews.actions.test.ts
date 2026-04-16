// src/test/buyerReviews.actions.test.ts
// ─── Tests: Buyer Reviews Server Action ─────────────────────────────────────
// Thin wrapper — auth gate + delegation to reviewService.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

const mockFetchBuyerReviews = vi.fn();
vi.mock("@/modules/reviews/review.service", () => ({
  reviewService: {
    fetchBuyerReviews: (...args: unknown[]) => mockFetchBuyerReviews(...args),
  },
}));

const { fetchBuyerReviews } = await import("@/server/actions/buyerReviews");

const TEST_USER = { id: "user_buyer", email: "b@test.com", isAdmin: false };

const sampleReview = {
  id: "rev_b1",
  sellerName: "Bob's Shop",
  rating: 5,
  comment: "Prompt payment, would sell to again.",
  listingTitle: "Coffee Mug",
  createdAt: "2026-04-01T10:00:00.000Z",
  buyerReply: null,
};

describe("fetchBuyerReviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockFetchBuyerReviews.mockResolvedValue([sampleReview]);
  });

  it("unauthenticated → returns safe error (no service call)", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await fetchBuyerReviews();

    expect(result.success).toBe(false);
    expect(mockFetchBuyerReviews).not.toHaveBeenCalled();
  });

  it("happy path → returns service payload unchanged", async () => {
    const result = await fetchBuyerReviews();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([sampleReview]);
    }
  });

  it("scopes lookup to authenticated user id", async () => {
    await fetchBuyerReviews();

    expect(mockFetchBuyerReviews).toHaveBeenCalledWith(TEST_USER.id);
  });

  it("empty review list → returns success with empty array", async () => {
    mockFetchBuyerReviews.mockResolvedValueOnce([]);

    const result = await fetchBuyerReviews();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it("service throws → returns safe fallback error without leaking", async () => {
    mockFetchBuyerReviews.mockRejectedValueOnce(new Error("DB timeout"));

    const result = await fetchBuyerReviews();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
      expect(result.error).not.toMatch(/DB timeout/);
    }
  });

  it("different user id → scopes correctly", async () => {
    mockRequireUser.mockResolvedValueOnce({ ...TEST_USER, id: "user_other" });

    await fetchBuyerReviews();

    expect(mockFetchBuyerReviews).toHaveBeenCalledWith("user_other");
  });
});
