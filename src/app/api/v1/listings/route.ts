// src/app/api/v1/listings/route.ts
// ─── Listings API ────────────────────────────────────────────────────────────

import { z } from "zod";
import { searchService } from "@/modules/listings/search.service";
import {
  apiOk,
  apiError,
  handleApiError,
  checkApiRateLimit,
} from "../_helpers/response";
import { listingsQuerySchema } from "@/modules/listings/listing.schema";

export async function GET(request: Request) {
  // Rate limit: reuse listing limiter (10/hr matches server action)
  const rateLimited = await checkApiRateLimit(request, "listing");
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(request.url);

    let query: z.infer<typeof listingsQuerySchema>;
    try {
      query = listingsQuerySchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return apiError("Validation failed", 400, "VALIDATION_ERROR");
      }
      throw err;
    }

    const results = await searchService.searchListings({
      query: query.q,
      category: query.category,
      page: query.page,
      pageSize: Math.min(query.pageSize, 48),
    });
    return apiOk(results);
  } catch (e) {
    return handleApiError(e);
  }
}
