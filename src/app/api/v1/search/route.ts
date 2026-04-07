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
import { getCorsHeaders, withCors } from "../_helpers/cors";

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
  // 60 requests per minute per IP — dedicated search limiter.
  // Lower than the browse limit because full-text search queries are more
  // expensive. Fails open if Redis is unavailable.
  const rateLimited = await checkApiRateLimit(request, "publicSearch");
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(request.url);
    const rawParams = Object.fromEntries(searchParams.entries());

    const parsed = SearchParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
      return withCors(
        apiError("Invalid search parameters", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
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
      request.headers.get("origin"),
    );
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=120",
    );
    return response;
  } catch (e) {
    return withCors(handleApiError(e), request.headers.get("origin"));
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
