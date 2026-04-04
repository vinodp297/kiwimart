// src/app/api/v1/search/route.ts
// ─── Public Search API ──────────────────────────────────────────────────────

import { z } from "zod";
import { searchService } from "@/modules/listings/search.service";
import {
  apiOk,
  apiError,
  handleApiError,
  checkApiRateLimit,
} from "../_helpers/response";

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
  cursor: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(48).optional().default(24),
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
      return apiError("Invalid search parameters", 400, "VALIDATION_ERROR");
    }

    const { cursor: page, limit, ...filters } = parsed.data;

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
      pageSize: limit,
    });

    const nextCursor = results.hasNextPage ? page + 1 : null;

    return apiOk({
      items: results.listings,
      nextCursor,
      hasMore: results.hasNextPage,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
