// src/modules/listings/search.service.ts
// ─── Search Service ──────────────────────────────────────────────────────────
// Full-text search using Postgres tsvector. Framework-free.
// Review aggregate now computed at DB level via groupBy (Sprint 3).

import db from "@/lib/db";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getThumbUrl } from "@/lib/image";
import { haversineKm } from "@/lib/geocoding";
import type { ListingCard } from "@/types";
import type { SearchParams, SearchResult } from "./listing.types";

const SearchParamsSchema = z.object({
  query: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  subcategory: z.string().max(100).optional(),
  condition: z.string().max(50).optional(),
  region: z.string().max(100).optional(),
  priceMin: z.number().min(0).optional(),
  priceMax: z.number().min(0).optional(),
  sort: z
    .enum(["newest", "oldest", "price-asc", "price-desc", "most-watched"])
    .optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  // Quick-filter chips
  isUrgent: z.boolean().optional(),
  isNegotiable: z.boolean().optional(),
  shipsNationwide: z.boolean().optional(),
  verifiedOnly: z.boolean().optional(),
  // Radius search
  searchLat: z.number().min(-90).max(90).optional(),
  searchLng: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().min(1).max(500).optional(),
});

function mapCondition(c: string): ListingCard["condition"] {
  const map: Record<string, ListingCard["condition"]> = {
    NEW: "new",
    LIKE_NEW: "like-new",
    GOOD: "good",
    FAIR: "fair",
    PARTS: "parts",
  };
  return map[c] ?? "good";
}

export class SearchService {
  async searchListings(rawParams: SearchParams): Promise<SearchResult> {
    const parseResult = SearchParamsSchema.safeParse(rawParams);
    const params = parseResult.success ? parseResult.data : {};

    const {
      query,
      category,
      subcategory,
      condition,
      region,
      priceMin,
      priceMax,
      sort = "newest",
      page = 1,
      pageSize = 24,
      isUrgent,
      isNegotiable,
      shipsNationwide,
      verifiedOnly,
      searchLat,
      searchLng,
      radiusKm,
    } = params;

    const trimmedQuery = query?.trim() || "";
    const useFts = trimmedQuery.length > 0;

    const where: Prisma.ListingWhereInput = {
      status: "ACTIVE",
      deletedAt: null,
      ...(category ? { categoryId: category } : {}),
      ...(subcategory
        ? {
            subcategoryName: {
              equals: subcategory,
              mode: "insensitive" as const,
            },
          }
        : {}),
      ...(condition
        ? {
            condition:
              condition.toUpperCase() as Prisma.EnumListingConditionFilter,
          }
        : {}),
      ...(region
        ? { region: { equals: region, mode: "insensitive" as const } }
        : {}),
      ...(priceMin != null || priceMax != null
        ? {
            priceNzd: {
              ...(priceMin != null ? { gte: Math.round(priceMin * 100) } : {}),
              ...(priceMax != null ? { lte: Math.round(priceMax * 100) } : {}),
            },
          }
        : {}),
      // Quick-filter chips
      ...(isUrgent ? { isUrgent: true } : {}),
      ...(isNegotiable ? { isNegotiable: true } : {}),
      ...(shipsNationwide ? { shipsNationwide: true } : {}),
      // Verified seller filter
      ...(verifiedOnly ? { seller: { idVerified: true } } : {}),
      // Radius search — require listings to have coordinates
      ...(searchLat != null && searchLng != null && radiusKm
        ? { locationLat: { not: null }, locationLng: { not: null } }
        : {}),
    };

    const useRadiusFilter =
      searchLat != null && searchLng != null && radiusKm != null;

    if (useFts) {
      try {
        const ftsIds = await db.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Listing"
          WHERE "searchVector" @@ plainto_tsquery('english', ${trimmedQuery})
            AND status = 'ACTIVE'
            AND "deletedAt" IS NULL
          LIMIT 500
        `;
        const idList = ftsIds.map((r) => r.id);
        if (idList.length === 0) {
          return {
            listings: [],
            totalCount: 0,
            page,
            pageSize,
            totalPages: 0,
            hasNextPage: false,
          };
        }
        where.id = { in: idList };
      } catch {
        where.OR = [
          { title: { contains: trimmedQuery, mode: "insensitive" as const } },
          {
            description: {
              contains: trimmedQuery,
              mode: "insensitive" as const,
            },
          },
        ];
      }
    }

    const orderBy: Prisma.ListingOrderByWithRelationInput = (() => {
      switch (sort) {
        case "oldest":
          return { createdAt: "asc" as const };
        case "price-asc":
          return { priceNzd: "asc" as const };
        case "price-desc":
          return { priceNzd: "desc" as const };
        case "most-watched":
          return { watcherCount: "desc" as const };
        default:
          return { createdAt: "desc" as const };
      }
    })();

    const skip = (page - 1) * pageSize;

    // When using radius filter, overfetch to allow post-query distance filtering
    const fetchLimit = useRadiusFilter ? Math.min(pageSize * 5, 200) : pageSize;

    const [totalCountRaw, rowsRaw] = await Promise.all([
      db.listing.count({ where }),
      db.listing.findMany({
        where,
        orderBy,
        skip: useRadiusFilter ? 0 : skip,
        take: useRadiusFilter ? fetchLimit : pageSize,
        select: {
          id: true,
          title: true,
          priceNzd: true,
          condition: true,
          categoryId: true,
          subcategoryName: true,
          region: true,
          suburb: true,
          shippingOption: true,
          shippingNzd: true,
          isOffersEnabled: true,
          isUrgent: true,
          isNegotiable: true,
          shipsNationwide: true,
          previousPriceNzd: true,
          priceDroppedAt: true,
          status: true,
          viewCount: true,
          watcherCount: true,
          createdAt: true,
          locationLat: true,
          locationLng: true,
          images: {
            where: { order: 0, isSafe: true },
            select: { r2Key: true, thumbnailKey: true },
            take: 1,
          },
          seller: {
            select: {
              id: true,
              username: true,
              displayName: true,
              idVerified: true,
            },
          },
        },
      }),
    ]);

    // Apply Haversine distance filter if radius search is active
    let rows = rowsRaw;
    let totalCount = totalCountRaw;
    if (
      useRadiusFilter &&
      searchLat != null &&
      searchLng != null &&
      radiusKm != null
    ) {
      rows = rowsRaw.filter((row) => {
        if (row.locationLat == null || row.locationLng == null) return false;
        return (
          haversineKm(searchLat, searchLng, row.locationLat, row.locationLng) <=
          radiusKm
        );
      });
      totalCount = rows.length;
      rows = rows.slice(skip, skip + pageSize);
    }

    // Batch-compute seller review stats at DB level (no N+1)
    const sellerIds = [...new Set(rows.map((r) => r.seller.id))];
    const sellerRatings = sellerIds.length
      ? await db.review.groupBy({
          by: ["subjectId"],
          where: {
            subjectId: { in: sellerIds },
            reviewerRole: "BUYER",
            isApproved: true,
          },
          _avg: { rating: true },
        })
      : [];
    const sellerRatingMap = new Map(
      sellerRatings.map((r) => [r.subjectId, r._avg.rating ?? 0]),
    );

    const listings: ListingCard[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      price: row.priceNzd / 100,
      condition: mapCondition(row.condition),
      categoryName: row.categoryId,
      subcategoryName: row.subcategoryName ?? "",
      region: row.region as ListingCard["region"],
      suburb: row.suburb,
      thumbnailUrl: getThumbUrl(row.images[0] ?? null),
      sellerName: row.seller.displayName,
      sellerUsername: row.seller.username,
      sellerRating: (() => {
        const fromGroupBy = sellerRatingMap.get(row.seller.id);
        if (fromGroupBy != null) return Math.round(fromGroupBy * 10) / 10;
        // Fallback: compute from inline reviewsAbout when available
        const inlineReviews = (
          row.seller as { reviewsAbout?: { rating: number }[] }
        ).reviewsAbout;
        if (inlineReviews?.length) {
          const avg =
            inlineReviews.reduce((s, r) => s + r.rating, 0) /
            inlineReviews.length;
          return Math.round(avg * 10) / 10;
        }
        return 0;
      })(),
      sellerVerified: row.seller.idVerified,
      viewCount: row.viewCount,
      watcherCount: row.watcherCount,
      createdAt: row.createdAt.toISOString(),
      status: row.status.toLowerCase() as ListingCard["status"],
      shippingOption:
        row.shippingOption.toLowerCase() as ListingCard["shippingOption"],
      shippingPrice: row.shippingNzd != null ? row.shippingNzd / 100 : null,
      isOffersEnabled: row.isOffersEnabled,
      isUrgent: row.isUrgent,
      isNegotiable: row.isNegotiable,
      shipsNationwide: row.shipsNationwide,
      previousPrice:
        row.previousPriceNzd != null ? row.previousPriceNzd / 100 : null,
      priceDroppedAt: row.priceDroppedAt
        ? row.priceDroppedAt.toISOString()
        : null,
    }));

    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      listings,
      totalCount,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
    };
  }
}

export const searchService = new SearchService();
