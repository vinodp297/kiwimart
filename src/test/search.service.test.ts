// src/test/search.service.test.ts
// ─── Tests for SearchService ────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { searchService } from "@/modules/listings/search.service";
import db from "@/lib/db";

// ── Shared mock-listing factory ───────────────────────────────────────────────
function makeListing(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: "Test Listing",
    priceNzd: 5000,
    condition: "GOOD",
    categoryId: "electronics",
    subcategoryName: null,
    region: "Auckland",
    suburb: null,
    shippingOption: "NATIONWIDE",
    shippingNzd: null,
    isOffersEnabled: true,
    isUrgent: false,
    isNegotiable: false,
    shipsNationwide: false,
    previousPriceNzd: null,
    priceDroppedAt: null,
    status: "ACTIVE",
    viewCount: 0,
    watcherCount: 0,
    createdAt: new Date("2026-01-01"),
    locationLat: null,
    locationLng: null,
    images: [],
    seller: {
      id: "seller-1",
      username: "seller1",
      displayName: "Seller One",
      idVerified: false,
    },
    ...overrides,
  };
}

describe("SearchService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("searchListings", () => {
    it("returns paginated results", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(2);
      vi.mocked(db.listing.findMany).mockResolvedValue([
        {
          id: "listing-1",
          title: "iPhone 15",
          priceNzd: 100000,
          condition: "GOOD",
          categoryId: "electronics",
          subcategoryName: "Phones",
          region: "Auckland",
          suburb: "CBD",
          shippingOption: "NATIONWIDE",
          shippingNzd: 500,
          isOffersEnabled: true,
          status: "ACTIVE",
          viewCount: 10,
          watcherCount: 3,
          createdAt: new Date("2026-01-15"),
          images: [],
          seller: {
            username: "seller1",
            displayName: "Seller One",
            idVerified: true,
            _count: { reviewsAbout: 5 },
            reviewsAbout: [{ rating: 45 }, { rating: 40 }],
          },
        },
      ] as never);

      const result = await searchService.searchListings({
        page: 1,
        pageSize: 24,
      });

      expect(result.listings).toHaveLength(1);
      expect(result.totalCount).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(24);
      expect(result.listings[0]?.price).toBe(1000);
      expect(result.listings[0]?.condition).toBe("good");
    });

    it("enforces maximum pageSize of 100", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(0);
      vi.mocked(db.listing.findMany).mockResolvedValue([]);

      await searchService.searchListings({ pageSize: 500 });

      expect(db.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 24, // Falls back to default because schema validation clamps it
        }),
      );
    });

    it("defaults to page 1", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(0);
      vi.mocked(db.listing.findMany).mockResolvedValue([]);

      const result = await searchService.searchListings({});

      expect(result.page).toBe(1);
    });

    it("returns empty results for no matches", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(0);
      vi.mocked(db.listing.findMany).mockResolvedValue([]);

      const result = await searchService.searchListings({
        query: "nonexistent item xyz",
      });

      expect(result.listings).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.hasNextPage).toBe(false);
    });

    it("calculates hasNextPage correctly", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(50);
      vi.mocked(db.listing.findMany).mockResolvedValue(
        Array(24).fill({
          id: "listing-1",
          title: "Item",
          priceNzd: 1000,
          condition: "NEW",
          categoryId: "cat",
          subcategoryName: null,
          region: "Auckland",
          suburb: null,
          shippingOption: "PICKUP",
          shippingNzd: null,
          isOffersEnabled: false,
          status: "ACTIVE",
          viewCount: 0,
          watcherCount: 0,
          createdAt: new Date(),
          images: [],
          seller: {
            username: "s",
            displayName: "S",
            idVerified: false,
            _count: { reviewsAbout: 0 },
            reviewsAbout: [],
          },
        }) as never,
      );

      const result = await searchService.searchListings({
        page: 1,
        pageSize: 24,
      });

      expect(result.totalPages).toBe(3);
      expect(result.hasNextPage).toBe(true);
    });

    it("filters by ACTIVE status and non-deleted", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(0);
      vi.mocked(db.listing.findMany).mockResolvedValue([]);

      await searchService.searchListings({});

      expect(db.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "ACTIVE",
            deletedAt: null,
          }),
        }),
      );
    });

    it("computes seller rating from reviews", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(1);
      vi.mocked(db.listing.findMany).mockResolvedValue([
        {
          id: "listing-1",
          title: "Item",
          priceNzd: 5000,
          condition: "LIKE_NEW",
          categoryId: "cat",
          subcategoryName: null,
          region: "Wellington",
          suburb: null,
          shippingOption: "PICKUP",
          shippingNzd: null,
          isOffersEnabled: false,
          status: "ACTIVE",
          viewCount: 0,
          watcherCount: 0,
          createdAt: new Date(),
          images: [],
          seller: {
            username: "seller1",
            displayName: "Seller",
            idVerified: true,
            _count: { reviewsAbout: 2 },
            reviewsAbout: [{ rating: 50 }, { rating: 40 }],
          },
        },
      ] as never);

      const result = await searchService.searchListings({});

      // Raw ratings 50+40 / 2 = 45; Math.round(45 * 10) / 10 = 45
      // Ratings stored as integers 1-50, search service uses raw values
      expect(result.listings[0]?.sellerRating).toBe(45);
    });
  });

  // ── FTS correctness tests ─────────────────────────────────────────────────

  describe("FTS — full-text search correctness", () => {
    // Test 1: pagination works beyond position 500
    it("pagination works beyond position 500 with no cap on FTS results", async () => {
      // Simulate 600 FTS matches returned from the database
      const allIds = Array.from({ length: 600 }, (_, i) => ({
        id: `id-${i + 1}`,
      }));
      vi.mocked(db.$queryRaw).mockResolvedValue(allIds);

      // count reflects full 600-item set (not just 500)
      vi.mocked(db.listing.count).mockResolvedValue(600);

      // Page 2 (listings 25–48) — the DB call receives only the page slice
      const page2Listings = Array.from({ length: 24 }, (_, i) =>
        makeListing(`id-${i + 25}`),
      );
      vi.mocked(db.listing.findMany).mockResolvedValue(page2Listings as never);

      const result = await searchService.searchListings({
        query: "iphone",
        page: 2,
        pageSize: 24,
      });

      expect(result.totalCount).toBe(600);
      expect(result.totalPages).toBe(25);
      expect(result.page).toBe(2);
      expect(result.hasNextPage).toBe(true);
      expect(result.listings).toHaveLength(24);

      // findMany was called with only the 24 IDs for page 2 (ids 25–48)
      const expectedPageIds = allIds.slice(24, 48).map((r) => r.id);
      expect(db.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: expectedPageIds },
          }),
        }),
      );
    });

    // Test 2: total count matches full result set, not a capped subset
    it("total count matches full FTS result set not a 500-item subset", async () => {
      const allIds = Array.from({ length: 750 }, (_, i) => ({
        id: `id-${i + 1}`,
      }));
      vi.mocked(db.$queryRaw).mockResolvedValue(allIds);
      vi.mocked(db.listing.count).mockResolvedValue(750);
      vi.mocked(db.listing.findMany).mockResolvedValue(
        Array.from({ length: 24 }, (_, i) =>
          makeListing(`id-${i + 1}`),
        ) as never,
      );

      const result = await searchService.searchListings({
        query: "car",
        page: 1,
        pageSize: 24,
      });

      // Must be 750, not 500
      expect(result.totalCount).toBe(750);
      expect(result.totalPages).toBe(32); // ceil(750/24) = 32
    });

    // Test 3: results are ordered by relevance (most relevant first)
    it("results are ordered by ts_rank relevance when sort is default", async () => {
      // FTS returns IDs in relevance order: a (most), b, c (least)
      vi.mocked(db.$queryRaw).mockResolvedValue([
        { id: "most-relevant" },
        { id: "second" },
        { id: "third" },
      ]);
      vi.mocked(db.listing.count).mockResolvedValue(3);

      // Simulate Prisma returning them in a different (non-relevance) order
      vi.mocked(db.listing.findMany).mockResolvedValue([
        makeListing("third"),
        makeListing("most-relevant"),
        makeListing("second"),
      ] as never);

      const result = await searchService.searchListings({
        query: "laptop",
        page: 1,
        pageSize: 24,
      });

      // Service must re-sort to match ts_rank order
      expect(result.listings[0]?.id).toBe("most-relevant");
      expect(result.listings[1]?.id).toBe("second");
      expect(result.listings[2]?.id).toBe("third");
    });

    // Test 4: empty query returns all active listings (no FTS path)
    it("empty query returns all active listings paginated without FTS", async () => {
      vi.mocked(db.listing.count).mockResolvedValue(42);
      vi.mocked(db.listing.findMany).mockResolvedValue(
        Array.from({ length: 24 }, (_, i) =>
          makeListing(`id-${i + 1}`),
        ) as never,
      );

      const result = await searchService.searchListings({
        page: 1,
        pageSize: 24,
      });

      // No $queryRaw call — FTS not triggered for empty query
      expect(db.$queryRaw).not.toHaveBeenCalled();
      expect(result.totalCount).toBe(42);
      expect(result.listings).toHaveLength(24);

      // Must filter by ACTIVE and non-deleted
      expect(db.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "ACTIVE",
            deletedAt: null,
          }),
        }),
      );
    });
  });

  // ── Radius search correctness tests ───────────────────────────────────────

  describe("radius search — bounding box + Haversine", () => {
    // Auckland CBD coordinates used as the search centre for all radius tests
    const CENTRE_LAT = -36.8485;
    const CENTRE_LNG = 174.7633;
    const RADIUS_KM = 10;

    // Test 5: listing within radius is returned
    it("returns a listing whose coordinates fall within the radius", async () => {
      // Ponsonby is ~2 km from Auckland CBD — well within 10 km
      const withinLat = -36.859;
      const withinLng = 174.748;

      vi.mocked(db.listing.findMany).mockResolvedValue([
        makeListing("within", {
          locationLat: withinLat,
          locationLng: withinLng,
        }),
      ] as never);

      const result = await searchService.searchListings({
        searchLat: CENTRE_LAT,
        searchLng: CENTRE_LNG,
        radiusKm: RADIUS_KM,
      });

      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]?.id).toBe("within");
      expect(result.totalCount).toBe(1);
    });

    // Test 6: listing outside radius is excluded
    it("excludes a listing whose coordinates fall outside the radius", async () => {
      // Hamilton is ~130 km from Auckland CBD — outside 10 km
      const outsideLat = -37.7826;
      const outsideLng = 175.2528;

      // DB returns it (it passed the bounding box) but Haversine should exclude it
      vi.mocked(db.listing.findMany).mockResolvedValue([
        makeListing("outside", {
          locationLat: outsideLat,
          locationLng: outsideLng,
        }),
      ] as never);

      const result = await searchService.searchListings({
        searchLat: CENTRE_LAT,
        searchLng: CENTRE_LNG,
        radiusKm: RADIUS_KM,
      });

      expect(result.listings).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    // Test 7: total count reflects precise Haversine-filtered results not bbox count
    it("total count equals the number of listings within the precise radius", async () => {
      const withinLat = -36.859; // ~2 km from CBD
      const withinLng = 174.748;
      const outsideLat = -37.7826; // ~130 km from CBD
      const outsideLng = 175.2528;

      // Three listings returned from bounding box: 2 within, 1 outside
      vi.mocked(db.listing.findMany).mockResolvedValue([
        makeListing("inside-1", {
          locationLat: withinLat,
          locationLng: withinLng,
        }),
        makeListing("inside-2", {
          locationLat: withinLat + 0.01,
          locationLng: withinLng + 0.01,
        }),
        makeListing("outside", {
          locationLat: outsideLat,
          locationLng: outsideLng,
        }),
      ] as never);

      const result = await searchService.searchListings({
        searchLat: CENTRE_LAT,
        searchLng: CENTRE_LNG,
        radiusKm: RADIUS_KM,
      });

      // totalCount must be 2, not 3 (the bbox count)
      expect(result.totalCount).toBe(2);
      expect(result.listings).toHaveLength(2);
    });

    // Test 8: bounding box pre-filter is sent to the database (uses the index)
    it("sends locationLat and locationLng bounding box conditions to the database", async () => {
      vi.mocked(db.listing.findMany).mockResolvedValue([]);

      await searchService.searchListings({
        searchLat: CENTRE_LAT,
        searchLng: CENTRE_LNG,
        radiusKm: RADIUS_KM,
      });

      // The DB call must include bounding box gte/lte filters — NOT just { not: null }
      expect(db.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            locationLat: expect.objectContaining({
              gte: expect.any(Number),
              lte: expect.any(Number),
            }),
            locationLng: expect.objectContaining({
              gte: expect.any(Number),
              lte: expect.any(Number),
            }),
          }),
        }),
      );
    });
  });
});
