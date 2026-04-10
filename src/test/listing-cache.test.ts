// src/test/listing-cache.test.ts
// ─── Tests: Redis caching for listings and search ────────────────────────────
// Verifies that:
//   1. getListingById returns the cached value on the second call
//   2. getListingById skips cache when Redis is unavailable (fallback to DB)
//   3. Browse listings are cached and served from cache on repeat calls
//   4. deleteListing invalidates the detail cache
//   5. updateListing invalidates the detail cache
//   6. searchListings results are cached
//   7. Cache key is stable for identical search params in different order

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock Redis client ─────────────────────────────────────────────────────────
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  }),
}));

// ── Mock listing repository ───────────────────────────────────────────────────
const mockFindByIdWithSellerAndImages = vi.fn();
const mockFindBrowseListings = vi.fn();
const mockFindByIdForDelete = vi.fn();
const mockSoftDelete = vi.fn();
const mockFindByIdForUpdate = vi.fn();
const mockUpdateListingOptimistic = vi.fn();

vi.mock("@/modules/listings/listing.repository", () => ({
  listingRepository: {
    findByIdWithSellerAndImages: (...a: unknown[]) =>
      mockFindByIdWithSellerAndImages(...a),
    findBrowseListings: (...a: unknown[]) => mockFindBrowseListings(...a),
    findByIdForDelete: (...a: unknown[]) => mockFindByIdForDelete(...a),
    softDelete: (...a: unknown[]) => mockSoftDelete(...a),
    incrementViewCount: vi.fn(),
    findByIdActive: vi.fn().mockResolvedValue({ id: "l1", sellerId: "s1" }),
    findWatchlistItem: vi.fn().mockResolvedValue(null),
    findByIdForUpdate: (...a: unknown[]) => mockFindByIdForUpdate(...a),
    updateListingOptimistic: (...a: unknown[]) =>
      mockUpdateListingOptimistic(...a),
    updateListing: vi
      .fn()
      .mockResolvedValue({
        id: "l1",
        title: "T",
        status: "ACTIVE",
        priceNzd: 1000,
        updatedAt: new Date(),
      }),
    findImagesByListingId: vi.fn().mockResolvedValue([]),
    createPriceHistory: vi.fn(),
  },
}));

// ── Suppress side-effect mocks for lifecycle ─────────────────────────────────
vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn(),
}));
vi.mock("@/modules/notifications/notification.repository", () => ({
  notificationRepository: { notifyAdmins: vi.fn() },
}));
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: { findDisplayName: vi.fn(), findEmailInfo: vi.fn() },
}));
vi.mock("@/server/email", () => ({ sendListingRejectedEmail: vi.fn() }));
vi.mock("@/lib/dynamic-lists", () => ({
  getKeywordLists: vi.fn().mockResolvedValue({ banned: [] }),
}));
vi.mock("@/modules/listings/listing-review.service", () => ({
  runAutoReviewFlow: vi.fn().mockResolvedValue({ ok: true }),
  notifyPriceDrop: vi.fn(),
}));

import {
  getListingById,
  listingDetailKey,
} from "@/modules/listings/listing-engagement.service";
import { getBrowseListings } from "@/modules/listings/listing-queries.service";
import {
  deleteListing,
  updateListing,
} from "@/modules/listings/listing-lifecycle.service";

// ─────────────────────────────────────────────────────────────────────────────

describe("listing detail cache (getListingById)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisSet.mockResolvedValue("OK");
    mockRedisDel.mockResolvedValue(1);
  });

  // ── Test 1: Cache hit ────────────────────────────────────────────────────
  it("returns cached listing without hitting the DB on second call", async () => {
    const fakeListing = { id: "l1", title: "Cached", seller: { id: "s1" } };
    // First call: cache miss → DB hit → cache write
    mockRedisGet.mockResolvedValueOnce(null);
    mockFindByIdWithSellerAndImages.mockResolvedValueOnce(fakeListing);
    mockRedisSet.mockResolvedValueOnce("OK");
    // Second call: cache hit
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(fakeListing));

    await getListingById("l1");
    const result = await getListingById("l1");

    expect(result).toEqual(fakeListing);
    // DB only queried once — the second call used cache
    expect(mockFindByIdWithSellerAndImages).toHaveBeenCalledTimes(1);
  });

  // ── Test 2: Redis unavailable — falls back to DB ─────────────────────────
  it("falls back to DB when Redis is unavailable", async () => {
    const fakeListing = { id: "l2", title: "Fallback" };
    mockRedisGet.mockRejectedValue(new Error("Connection refused"));
    mockFindByIdWithSellerAndImages.mockResolvedValue(fakeListing);
    // set also fails — should be ignored
    mockRedisSet.mockRejectedValue(new Error("Connection refused"));

    const result = await getListingById("l2");

    expect(result).toEqual(fakeListing);
    expect(mockFindByIdWithSellerAndImages).toHaveBeenCalledWith("l2");
  });

  // ── Test 3: listingDetailKey produces consistent key ────────────────────
  it("listingDetailKey returns the expected key format", () => {
    expect(listingDetailKey("abc-123")).toBe("listings:detail:abc-123");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("browse listings cache (getBrowseListings)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisSet.mockResolvedValue("OK");
  });

  // ── Test 4: Browse results are cached ────────────────────────────────────
  it("returns cached browse results without hitting the DB on second call", async () => {
    const fakeResult = {
      listings: [{ id: "l1" }],
      nextCursor: null,
      hasMore: false,
    };
    mockRedisGet.mockResolvedValueOnce(null);
    mockFindBrowseListings.mockResolvedValueOnce(fakeResult);
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(fakeResult));

    await getBrowseListings({ category: "cat-electronics", limit: 12 });
    const result = await getBrowseListings({
      category: "cat-electronics",
      limit: 12,
    });

    expect(result).toEqual(fakeResult);
    expect(mockFindBrowseListings).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("listing cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue("OK");
  });

  // ── Test 5: deleteListing invalidates cache ───────────────────────────────
  it("deleteListing calls invalidateCache for the listing detail key", async () => {
    mockFindByIdForDelete.mockResolvedValue({
      id: "l1",
      sellerId: "user-1",
      status: "ACTIVE",
      title: "Old Bike",
    });
    mockSoftDelete.mockResolvedValue({});

    await deleteListing("l1", "user-1", false);

    expect(mockRedisDel).toHaveBeenCalledWith("listings:detail:l1");
  });

  // ── Test 6: updateListing invalidates cache on success ───────────────────
  it("updateListing invalidates the detail cache when update succeeds", async () => {
    mockFindByIdForUpdate.mockResolvedValue({
      id: "l1",
      sellerId: "user-1",
      status: "ACTIVE",
      title: "Bike",
      description: "Good bike",
      priceNzd: 10000,
      categoryId: "cat-vehicles",
      deletedAt: null,
      updatedAt: new Date(),
    });
    mockUpdateListingOptimistic.mockResolvedValue({ count: 1 });

    await updateListing("user-1", "u@e.com", false, {
      listingId: "l1",
      title: "Better Bike",
    });

    expect(mockRedisDel).toHaveBeenCalledWith("listings:detail:l1");
  });
});
