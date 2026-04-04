// src/app/api/v1/search/route.ts
// ─── Public Search API ──────────────────────────────────────────────────────
//
// Pagination: offset-based (page / pageSize), NOT cursor-based.
//
// Why not cursor pagination here:
//   1. Full-text search uses $queryRaw with tsvector — fetches up to 500 IDs
//      as a fixed list, then filters down. A cursor into an arbitrary id-list
//      has no stable meaning across requests.
//   2. Radius search applies Haversine filtering in-memory after the DB query.
//      The post-query slice changes whenever the raw result set shifts.
//   3. Sort options (most-watched, price) use non-unique, volatile columns —
//      cursor ordering requires a stable, unique sort key.
//
// All other /api/v1/* list endpoints use cursor pagination.

import { z } from "zod";
import { searchService } from "@/modules/listings/search.service";
import {
  apiOk,
  apiError,
  handleApiError,
  checkApiRateLimit,
} from "../_helpers/response";
import { corsHeaders, withCors } from "../_helpers/cors";

const SearchParamsSchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  subcategory: z.string().max(100).optional(),
  condition: z.string().max(50).optional(),
  region: z.string().max(100).optional(),
  priceMin: z.coerce.number().min(0).max(1000000).optional(),
  priceMax: z.coerce.number().min(0).max(1000000).optional(),
  sort: z
    .enum(["newest", "oldest", "price-asc", "price-desc", "most-watched"])
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().min(1).max(48).optional().default(24),
});

export async function GET(request: Request) {
  // Rate limit: 30 req/min for search
  const rateLimited = await checkApiRateLimit(request, "listing");
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(request.url);
    const rawParams = Object.fromEntries(searchParams.entries());

    const parsed = SearchParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
      return withCors(
        apiError("Invalid search parameters", 400, "VALIDATION_ERROR"),
      );
    }

    const { page, pageSize, ...filters } = parsed.data;

    const results = await searchService.searchListings({
      query: filters.q,
      category: filters.category,
      subcategory: filters.subcategory,
      condition: filters.condition,
      region: filters.region,
      priceMin: filters.priceMin,
      priceMax: filters.priceMax,
      sort: filters.sort,
      page,
      pageSize,
    });

    const response = withCors(
      apiOk({
        listings: results.listings,
        page: results.page,
        pageSize: results.pageSize,
        hasMore: results.hasNextPage,
        total: results.totalCount,
        totalPages: results.totalPages,
      }),
    );
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=120",
    );
    return response;
  } catch (e) {
    return withCors(handleApiError(e));
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
