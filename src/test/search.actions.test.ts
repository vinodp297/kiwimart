// src/test/search.actions.test.ts
// ─── Tests: Listing Search Server Action ────────────────────────────────────
// Thin wrapper — verifies delegation to SearchService and pass-through of
// params, result, and errors. Business logic lives in search.service.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock searchService ───────────────────────────────────────────────────────
const mockSearchListings = vi.fn();
vi.mock("@/modules/listings/search.service", () => ({
  searchService: {
    searchListings: (...args: unknown[]) => mockSearchListings(...args),
  },
}));

// ── Lazy import ──────────────────────────────────────────────────────────────
const { searchListings } = await import("@/server/actions/search");

// ─────────────────────────────────────────────────────────────────────────────
// searchListings
// ─────────────────────────────────────────────────────────────────────────────

describe("searchListings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchListings.mockResolvedValue({
      items: [],
      nextCursor: null,
      totalCount: 0,
      facets: {},
    });
  });

  it("delegates to searchService.searchListings with raw params", async () => {
    const params = { query: "widget", take: 20 };

    await searchListings(params as never);

    expect(mockSearchListings).toHaveBeenCalledWith(params);
  });

  it("returns service payload unchanged", async () => {
    const payload = {
      items: [{ id: "listing_1", title: "Test" }],
      nextCursor: "cursor_1",
      totalCount: 1,
      facets: { categories: [] },
    };
    mockSearchListings.mockResolvedValueOnce(payload);

    const result = await searchListings({ query: "anything" } as never);

    expect(result).toBe(payload);
  });

  it("forwards empty params object unchanged", async () => {
    await searchListings({} as never);

    expect(mockSearchListings).toHaveBeenCalledWith({});
  });

  it("forwards filter params (category, minPrice, maxPrice, condition)", async () => {
    const params = {
      category: "electronics",
      minPrice: 100,
      maxPrice: 500,
      condition: "NEW",
    };

    await searchListings(params as never);

    expect(mockSearchListings).toHaveBeenCalledWith(params);
  });

  it("service throws → propagates error (no ActionResult envelope)", async () => {
    mockSearchListings.mockRejectedValueOnce(new Error("Meilisearch down"));

    await expect(searchListings({ query: "x" } as never)).rejects.toThrow(
      "Meilisearch down",
    );
  });

  it("forwards pagination cursor parameter", async () => {
    await searchListings({
      query: "test",
      cursor: "prev_cursor",
      take: 10,
    } as never);

    expect(mockSearchListings).toHaveBeenCalledWith({
      query: "test",
      cursor: "prev_cursor",
      take: 10,
    });
  });
});
