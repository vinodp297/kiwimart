// src/app/api/v1/listings/route.ts
// ─── Listings API ────────────────────────────────────────────────────────────

import { z } from "zod";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
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

    const { q, category, cursor, limit } = query;

    const where: Prisma.ListingWhereInput = {
      status: "ACTIVE",
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(category ? { categoryId: category } : {}),
    };

    const raw = await db.listing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        priceNzd: true,
        condition: true,
        categoryId: true,
        region: true,
        createdAt: true,
        images: {
          where: { order: 0, safe: true },
          select: { thumbnailKey: true },
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
    });

    const hasMore = raw.length > limit;
    const listings = hasMore ? raw.slice(0, limit) : raw;
    const nextCursor = hasMore ? (listings.at(-1)?.id ?? null) : null;

    return apiOk({ listings, nextCursor, hasMore });
  } catch (e) {
    return handleApiError(e);
  }
}
