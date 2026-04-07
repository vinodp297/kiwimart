// src/app/api/v1/listings/route.ts
// ─── Listings API ────────────────────────────────────────────────────────────

import { z } from "zod";
import { createListingSchema } from "@/server/validators";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../_helpers/response";
import { getCorsHeaders, withCors } from "../_helpers/cors";
import { listingsQuerySchema } from "@/modules/listings/listing.schema";
import { listingService } from "@/modules/listings/listing.service";

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
        return withCors(
          apiError("Validation failed", 400, "VALIDATION_ERROR"),
          request.headers.get("origin"),
        );
      }
      throw err;
    }

    const { listings, nextCursor, hasMore } =
      await listingService.getBrowseListings(query);

    const response = withCors(
      apiOk({ listings, nextCursor, hasMore }),
      request.headers.get("origin"),
    );
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    return response;
  } catch (e) {
    return withCors(handleApiError(e), request.headers.get("origin"));
  }
}

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "listing");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);

    // Parse body
    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const parsed = createListingSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(
        apiError("Validation failed", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }
    const data = parsed.data;

    // User-based rate limit (10/hr)
    const limit = await rateLimit("listing", user.id);
    if (!limit.success) {
      return withCors(
        apiError(
          `Too many listings created. Try again in ${limit.retryAfter} seconds.`,
          429,
        ),
        request.headers.get("origin"),
      );
    }

    const ip = getClientIp(new Headers(request.headers)) || "unknown";
    const result = await listingService.createListingViaApi(
      user.id,
      user.isStripeOnboarded,
      data,
      ip,
    );

    if (!result.ok) {
      return withCors(
        apiError(result.error, result.statusCode, result.code),
        request.headers.get("origin"),
      );
    }

    return withCors(
      apiOk({ listing: result.listing }, 201),
      request.headers.get("origin"),
    );
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
