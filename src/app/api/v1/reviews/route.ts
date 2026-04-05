// src/app/api/v1/reviews/route.ts
// ─── Reviews API ─────────────────────────────────────────────────────────────
// GET  /api/v1/reviews — list reviews (public, cursor pagination)
// POST /api/v1/reviews — create a review for a completed order (buyer or seller)

import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { createReviewSchema } from "@/server/validators";
import { reviewService } from "@/modules/reviews/review.service";
import { logger } from "@/shared/logger";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../_helpers/response";
import { corsHeaders, withCors } from "../_helpers/cors";
import { rateLimit } from "@/server/lib/rateLimit";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor") ?? undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 50);
    const sellerId = searchParams.get("sellerId") ?? undefined;
    const buyerId = searchParams.get("buyerId") ?? undefined;

    const where: Prisma.ReviewWhereInput = { approved: true };
    if (sellerId) where.subjectId = sellerId;
    if (buyerId) where.authorId = buyerId;

    const raw = await db.review.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        rating: true,
        comment: true,
        reply: true,
        reviewerRole: true,
        createdAt: true,
        author: { select: { displayName: true, username: true } },
      },
    });

    const hasMore = raw.length > limit;
    const reviews = hasMore ? raw.slice(0, limit) : raw;
    const nextCursor = hasMore ? (reviews.at(-1)?.id ?? null) : null;

    const res = withCors(apiOk({ reviews, nextCursor, hasMore }));
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e) {
    logger.error("api.error", {
      path: "/api/v1/reviews GET",
      error: e instanceof Error ? e.message : String(e),
    });
    return withCors(handleApiError(e));
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);

    const rl = await rateLimit("review", user.id);
    if (!rl.success) {
      return withCors(
        apiError(
          `Too many reviews submitted. Try again in ${rl.retryAfter} seconds.`,
          429,
          "RATE_LIMITED",
        ),
      );
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
      );
    }

    const parsed = createReviewSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(apiError("Validation failed", 400, "VALIDATION_ERROR"));
    }

    const result = await reviewService.createReview(parsed.data, user.id);
    return withCors(apiOk(result, 201));
  } catch (e) {
    return withCors(handleApiError(e));
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
