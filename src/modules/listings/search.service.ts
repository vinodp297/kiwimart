// src/modules/listings/search.service.ts
// ─── Search Service ──────────────────────────────────────────────────────────
// Full-text search using Postgres tsvector. Framework-free.
// Review aggregate now computed at DB level via groupBy (Sprint 3).

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getThumbUrl } from "@/lib/image";
import { haversineKm } from "@/lib/geocoding";
import { toCents } from "@/lib/currency";
import { logger } from "@/shared/logger";
import { listingRepository } from "./listing.repository";
import { reviewRepository } from "@/modules/reviews/review.repository";
import { getCached } from "@/server/lib/cache";
import { SECONDS_PER_MINUTE } from "@/lib/time";
import type { ListingCard } from "@/types";
import type { SearchParams, SearchResult } from "./listing.types";

const SEARCH_CACHE_TTL = SECONDS_PER_MINUTE;

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
    const params = parseResult.success
      ? parseResult.data
      : ({} as z.infer<typeof SearchParamsSchema>);

    // Build a stable, sorted cache key from validated params
    const cacheKey = `listings:search:${JSON.stringify(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    )}`;
    return getCached(cacheKey, () => this._doSearch(params), SEARCH_CACHE_TTL);
  }

  private async _doSearch(
    params: z.infer<typeof SearchParamsSchema>,
  ): Promise<SearchResult> {
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

    // For the default-sort + no-radius FTS path we push pagination into the DB
    // (LIMIT/OFFSET inside searchByVector) so we never hold a 1 000-element
    // ID array in memory.  All other FTS paths still use the bounded ID-list
    // approach (max 1 000 IDs) because they need the IDs as a Prisma IN-filter
    // for secondary sorts or bounding-box queries.
    const canUseFtsRelevancePagination =
      useFts && sort === "newest" && !searchLat && !searchLng && !radiusKm;

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
              ...(priceMin != null ? { gte: toCents(priceMin) } : {}),
              ...(priceMax != null ? { lte: toCents(priceMax) } : {}),
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

    // ── FTS: load ranked IDs (non-relevance paths only) ──────────────────
    // For the relevance path (sort=newest, no radius) pagination is pushed
    // into the SQL query — see the useFtsRelevance branch in the fetch
    // strategy below.  For all other FTS paths we collect up to 1 000 IDs
    // so they can be used as a Prisma IN-filter alongside secondary sorts
    // or bounding-box conditions.
    const MAX_FTS_IDS = 1000;
    if (useFts && !canUseFtsRelevancePagination) {
      try {
        const ftsResult = await listingRepository.searchByVector(
          trimmedQuery,
          0,
          MAX_FTS_IDS,
        );
        const ftsRankedIds = ftsResult.map((r) => r.id);
        if (ftsRankedIds.length === 0) {
          return {
            listings: [],
            totalCount: 0,
            page,
            pageSize,
            totalPages: 0,
            hasNextPage: false,
          };
        }
        where.id = { in: ftsRankedIds };
      } catch (error) {
        // Fall back to ILIKE when tsvector is unavailable — but observe the
        // fallback so we know if Postgres FTS is silently broken.
        logger.warn("search.fts_fallback", {
          error: error instanceof Error ? error.message : String(error),
          query: trimmedQuery,
        });
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

    // ── Radius: bounding-box pre-filter added to where clause ─────────────
    // The bounding box uses the @@index([locationLat, locationLng]) index so
    // the DB returns a small, geo-bounded subset. We then apply precise
    // Haversine in the service (bounding box is square, radius is circular).
    if (
      useRadiusFilter &&
      searchLat != null &&
      searchLng != null &&
      radiusKm != null
    ) {
      const KM_PER_DEGREE_LAT = 111.0;
      const latDelta = radiusKm / KM_PER_DEGREE_LAT;
      const lngDelta =
        radiusKm / (KM_PER_DEGREE_LAT * Math.cos((searchLat * Math.PI) / 180));
      // Replace the null-check with indexed bounding-box filter
      where.locationLat = {
        gte: searchLat - latDelta,
        lte: searchLat + latDelta,
      };
      where.locationLng = {
        gte: searchLng - lngDelta,
        lte: searchLng + lngDelta,
      };
    }

    // ── Determine fetch strategy ──────────────────────────────────────────
    // useFtsRelevance: preserve ts_rank order when sort is default and no
    // radius filter is active. Pagination is done at the DB level (LIMIT /
    // OFFSET inside searchByVector) — we never load all ranked IDs into memory.
    // For other sorts or radius, Prisma's orderBy takes precedence and we use
    // the bounded ID-list approach populated above.
    const useFtsRelevance = canUseFtsRelevancePagination;

    let rows: Awaited<ReturnType<typeof listingRepository.findSearchResults>>;
    let totalCount: number;

    if (useFtsRelevance) {
      // DB-level FTS pagination: fetch only the page's IDs from Postgres, get
      // the total count in a parallel COUNT query.  Re-sort Prisma results to
      // restore ts_rank order (IN-list order is not guaranteed by Postgres).
      try {
        const [dbCount, pageResults] = await Promise.all([
          listingRepository.countByVector(trimmedQuery),
          listingRepository.searchByVector(trimmedQuery, skip, pageSize),
        ]);
        totalCount = dbCount;
        const pageIds = pageResults.map((r) => r.id);
        rows = pageIds.length
          ? await listingRepository.findSearchResults(
              { ...where, id: { in: pageIds } },
              orderBy,
              0,
              pageIds.length,
            )
          : [];
        const rowMap = new Map(rows.map((r) => [r.id, r]));
        rows = pageIds
          .map((id) => rowMap.get(id))
          .filter((r): r is NonNullable<typeof r> => r != null);
      } catch (ftsErr) {
        // FTS unavailable — fall back to ILIKE standard path so the search
        // page still renders rather than returning an error.
        logger.warn("search.fts_pagination_fallback", {
          error: ftsErr instanceof Error ? ftsErr.message : String(ftsErr),
          query: trimmedQuery,
        });
        where.OR = [
          { title: { contains: trimmedQuery, mode: "insensitive" as const } },
          {
            description: {
              contains: trimmedQuery,
              mode: "insensitive" as const,
            },
          },
        ];
        [totalCount, rows] = await Promise.all([
          listingRepository.countSearch(where),
          listingRepository.findSearchResults(where, orderBy, skip, pageSize),
        ]);
      }
    } else if (
      useRadiusFilter &&
      searchLat != null &&
      searchLng != null &&
      radiusKm != null
    ) {
      // Bounding box rows come back already indexed — at most a few thousand
      // for any realistic NZ radius. Precise Haversine then filters the square
      // corners. Total count is the precise post-filter count, not the bbox count.
      const MAX_RADIUS_RESULTS = 2000;
      const allBboxRows = await listingRepository.findSearchResults(
        where,
        orderBy,
        0,
        MAX_RADIUS_RESULTS,
      );
      const preciseRows = allBboxRows.filter((row) => {
        if (row.locationLat == null || row.locationLng == null) return false;
        return (
          haversineKm(searchLat, searchLng, row.locationLat, row.locationLng) <=
          radiusKm
        );
      });
      totalCount = preciseRows.length;
      rows = preciseRows.slice(skip, skip + pageSize);
    } else {
      // Standard path: DB handles all filtering, sorting, and pagination.
      [totalCount, rows] = await Promise.all([
        listingRepository.countSearch(where),
        listingRepository.findSearchResults(where, orderBy, skip, pageSize),
      ]);
    }

    // Batch-compute seller review stats at DB level (no N+1)
    const sellerIds = [...new Set(rows.map((r) => r.seller.id))];
    const sellerRatings = sellerIds.length
      ? await reviewRepository.groupBySellerRating(sellerIds)
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
