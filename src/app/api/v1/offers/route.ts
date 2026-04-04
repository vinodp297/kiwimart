// src/app/api/v1/offers/route.ts
// ─── Offers API ──────────────────────────────────────────────────────────────
// GET  /api/v1/offers — list offers for the authenticated user (cursor pagination)
// POST /api/v1/offers — create a new offer on a listing

import db from "@/lib/db";
import { createOfferSchema } from "@/server/validators";
import { offerService } from "@/modules/offers/offer.service";
import { getClientIp } from "@/server/lib/rateLimit";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../_helpers/response";
import { corsHeaders, withCors } from "../_helpers/cors";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor") ?? undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 50);
    const role = searchParams.get("role"); // "buyer" | "seller" | null (both)

    const where =
      role === "buyer"
        ? { buyerId: user.id }
        : role === "seller"
          ? { sellerId: user.id }
          : { OR: [{ buyerId: user.id }, { sellerId: user.id }] };

    const raw = await db.offer.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        listing: { select: { id: true, title: true, priceNzd: true } },
      },
    });

    const hasMore = raw.length > limit;
    const offers = hasMore ? raw.slice(0, limit) : raw;
    const nextCursor = hasMore ? (offers.at(-1)?.id ?? null) : null;

    return withCors(apiOk({ offers, nextCursor, hasMore }));
  } catch (e) {
    return withCors(handleApiError(e));
  }
}

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "offer");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);

    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
      );
    }

    const parsed = createOfferSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(apiError("Validation failed", 400, "VALIDATION_ERROR"));
    }

    const ip = getClientIp(new Headers(request.headers)) || "unknown";
    const result = await offerService.createOffer(parsed.data, user.id, ip);
    return withCors(apiOk(result, 201));
  } catch (e) {
    return withCors(handleApiError(e));
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
