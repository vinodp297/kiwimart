// src/test/recentlyViewed.actions.test.ts
// ─── Tests: Recently Viewed Server Actions ──────────────────────────────────
// Covers:
//   recordListingView     — upsert, trim-to-cap, fault tolerance
//   getRecentlyViewedFromDB — returns newest first, filters inactive listings

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock repository ───────────────────────────────────────────────────────────
const mockUpsertView = vi.fn();
const mockFindOlderThanCap = vi.fn();
const mockDeleteManyByIds = vi.fn();
const mockFindByUser = vi.fn();

vi.mock("@/modules/listings/recently-viewed.repository", () => ({
  recentlyViewedRepository: {
    upsertView: (...args: unknown[]) => mockUpsertView(...args),
    findOlderThanCap: (...args: unknown[]) => mockFindOlderThanCap(...args),
    deleteManyByIds: (...args: unknown[]) => mockDeleteManyByIds(...args),
    findByUser: (...args: unknown[]) => mockFindByUser(...args),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { recordListingView, getRecentlyViewedFromDB } =
  await import("@/server/actions/recentlyViewed");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER = { id: "user_1", email: "u@test.com", isAdmin: false };

// ─────────────────────────────────────────────────────────────────────────────
// recordListingView
// ─────────────────────────────────────────────────────────────────────────────

describe("recordListingView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockUpsertView.mockResolvedValue(undefined);
    mockFindOlderThanCap.mockResolvedValue([]);
    mockDeleteManyByIds.mockResolvedValue(undefined);
  });

  it("unauthenticated → returns error (does not upsert)", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await recordListingView("listing_1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
    expect(mockUpsertView).not.toHaveBeenCalled();
  });

  it("happy path with no trim → calls upsert only", async () => {
    const result = await recordListingView("listing_1");

    expect(result.success).toBe(true);
    expect(mockUpsertView).toHaveBeenCalledWith(TEST_USER.id, "listing_1");
    expect(mockDeleteManyByIds).not.toHaveBeenCalled();
  });

  it("trims oldest entries when beyond MAX_PER_USER cap", async () => {
    mockFindOlderThanCap.mockResolvedValueOnce([
      { id: "rv_old_1" },
      { id: "rv_old_2" },
    ]);

    const result = await recordListingView("listing_1");

    expect(result.success).toBe(true);
    expect(mockFindOlderThanCap).toHaveBeenCalledWith(TEST_USER.id, 20);
    expect(mockDeleteManyByIds).toHaveBeenCalledWith(["rv_old_1", "rv_old_2"]);
  });

  it("upsert throws → returns safe error", async () => {
    mockUpsertView.mockRejectedValueOnce(new Error("DB offline"));

    const result = await recordListingView("listing_1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/failed to record/i);
    }
  });

  it("findOlderThanCap throws → still reports failure (non-critical view)", async () => {
    mockFindOlderThanCap.mockRejectedValueOnce(new Error("Timeout"));

    const result = await recordListingView("listing_1");

    expect(result.success).toBe(false);
  });

  it("scopes record to authenticated user id", async () => {
    mockRequireUser.mockResolvedValueOnce({ ...TEST_USER, id: "user_alt" });

    await recordListingView("listing_1");

    expect(mockUpsertView).toHaveBeenCalledWith("user_alt", "listing_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getRecentlyViewedFromDB
// ─────────────────────────────────────────────────────────────────────────────

describe("getRecentlyViewedFromDB", () => {
  function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "rv_1",
      viewedAt: new Date("2026-04-15T10:00:00Z"),
      listing: {
        id: "listing_1",
        title: "Test Widget",
        priceNzd: 5_000, // $50 in cents
        condition: "NEW",
        status: "ACTIVE",
        deletedAt: null,
        images: [{ thumbnailKey: "thumb.webp", r2Key: "full.webp" }],
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockFindByUser.mockResolvedValue([makeRow()]);
  });

  it("unauthenticated → returns error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await getRecentlyViewedFromDB();

    expect(result.success).toBe(false);
    expect(mockFindByUser).not.toHaveBeenCalled();
  });

  it("happy path → maps rows to RecentlyViewedRow shape", async () => {
    const result = await getRecentlyViewedFromDB();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: "listing_1",
        title: "Test Widget",
        price: 50, // cents → dollars
        condition: "new",
        viewedAt: "2026-04-15T10:00:00.000Z",
      });
      expect(result.data[0].thumbnailUrl).toBeTruthy();
    }
  });

  it("filters out inactive listings (status != ACTIVE)", async () => {
    mockFindByUser.mockResolvedValueOnce([
      makeRow({
        listing: { ...makeRow().listing, status: "SOLD" },
      }),
      makeRow({ id: "rv_2" }),
    ]);

    const result = await getRecentlyViewedFromDB();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
    }
  });

  it("filters out soft-deleted listings (deletedAt != null)", async () => {
    mockFindByUser.mockResolvedValueOnce([
      makeRow({
        listing: {
          ...makeRow().listing,
          deletedAt: new Date(),
        },
      }),
    ]);

    const result = await getRecentlyViewedFromDB();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it("respects limit parameter (passed to repository)", async () => {
    await getRecentlyViewedFromDB(5);

    expect(mockFindByUser).toHaveBeenCalledWith(TEST_USER.id, 5);
  });

  it("defaults limit to 20 when not provided", async () => {
    await getRecentlyViewedFromDB();

    expect(mockFindByUser).toHaveBeenCalledWith(TEST_USER.id, 20);
  });

  it("falls back to r2Key when thumbnailKey is missing", async () => {
    mockFindByUser.mockResolvedValueOnce([
      makeRow({
        listing: {
          ...makeRow().listing,
          images: [{ thumbnailKey: null, r2Key: "full-fallback.webp" }],
        },
      }),
    ]);

    const result = await getRecentlyViewedFromDB();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].thumbnailUrl).toBeTruthy();
    }
  });

  it("repository throws → returns safe error", async () => {
    mockFindByUser.mockRejectedValueOnce(new Error("DB connection lost"));

    const result = await getRecentlyViewedFromDB();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/failed to fetch/i);
    }
  });
});
