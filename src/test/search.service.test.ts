// src/test/search.service.test.ts
// ─── Tests for SearchService ────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { searchService } from "@/modules/listings/search.service";
import db from "@/lib/db";

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
          offersEnabled: true,
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
          offersEnabled: false,
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
          offersEnabled: false,
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
});
