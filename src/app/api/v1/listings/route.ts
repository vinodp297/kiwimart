// src/app/api/v1/listings/route.ts
// ─── Listings API ────────────────────────────────────────────────────────────

import { z } from "zod";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { userRepository } from "@/modules/users/user.repository";
import { createListingSchema } from "@/server/validators";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../_helpers/response";
import { corsHeaders, withCors } from "../_helpers/cors";
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
        return withCors(apiError("Validation failed", 400, "VALIDATION_ERROR"));
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

    const response = withCors(apiOk({ listings, nextCursor, hasMore }));
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    return response;
  } catch (e) {
    return withCors(handleApiError(e));
  }
}

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "listing");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);

    // Check seller prerequisites
    const userDetails = await userRepository.findForListingAuth(user.id);
    if (!userDetails?.emailVerified) {
      return withCors(
        apiError(
          "Please verify your email address before creating a listing.",
          403,
          "EMAIL_NOT_VERIFIED",
        ),
      );
    }
    if (!userDetails.sellerTermsAcceptedAt) {
      return withCors(
        apiError(
          "Please accept seller terms before listing items.",
          403,
          "TERMS_NOT_ACCEPTED",
        ),
      );
    }
    if (!user.stripeOnboarded) {
      return withCors(
        apiError(
          "Please set up your payment account before listing items.",
          403,
          "STRIPE_NOT_ONBOARDED",
        ),
      );
    }

    // Parse body
    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
      );
    }

    const parsed = createListingSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(apiError("Validation failed", 400, "VALIDATION_ERROR"));
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
      );
    }

    // Validate category
    const category = await db.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    });
    if (!category) {
      return withCors(apiError("Invalid category", 400, "INVALID_CATEGORY"));
    }

    // Validate images
    const images = await db.listingImage.findMany({
      where: { r2Key: { in: data.imageKeys } },
      select: { r2Key: true, scanned: true, safe: true },
    });
    const missingKeys = data.imageKeys.filter(
      (key) => !images.some((img) => img.r2Key === key),
    );
    const unsafeImages = images.filter((img) => !img.scanned || !img.safe);
    if (missingKeys.length > 0 || unsafeImages.length > 0) {
      return withCors(
        apiError(
          "One or more photos could not be verified. Please re-upload.",
          400,
          "IMAGE_VALIDATION_FAILED",
        ),
      );
    }

    // Create listing in transaction
    const listing = await db.$transaction(async (tx) => {
      const created = await tx.listing.create({
        data: {
          sellerId: user.id,
          title: data.title,
          description: data.description,
          priceNzd: Math.round(data.price * 100),
          gstIncluded: data.gstIncluded,
          condition: data.condition,
          status: "PENDING_REVIEW",
          categoryId: data.categoryId,
          subcategoryName: data.subcategoryName ?? null,
          region: data.region,
          suburb: data.suburb,
          shippingOption: data.shippingOption,
          shippingNzd:
            data.shippingPrice != null
              ? Math.round(data.shippingPrice * 100)
              : null,
          pickupAddress: data.pickupAddress ?? null,
          offersEnabled: data.offersEnabled,
          isUrgent: data.isUrgent,
          isNegotiable: data.isNegotiable,
          shipsNationwide: data.shipsNationwide,
          images: {
            create: data.imageKeys.map((key, i) => ({
              r2Key: key,
              order: i,
            })),
          },
          attrs: {
            create: data.attributes.map((attr, i) => ({
              label: attr.label,
              value: attr.value,
              order: i,
            })),
          },
        },
        select: { id: true, status: true },
      });

      if (!userDetails.sellerEnabled) {
        await tx.user.update({
          where: { id: user.id },
          data: { sellerEnabled: true },
        });
      }

      return created;
    });

    // Price history (fire-and-forget)
    db.listingPriceHistory
      .create({
        data: {
          listingId: listing.id,
          priceNzd: Math.round(data.price * 100),
        },
      })
      .catch(() => {});

    const ip = getClientIp(new Headers(request.headers)) || "unknown";
    audit({
      userId: user.id,
      action: "LISTING_CREATED",
      entityType: "Listing",
      entityId: listing.id,
      metadata: { title: data.title, channel: "api" },
      ip,
    });

    logger.info("listing.created.api", {
      listingId: listing.id,
      userId: user.id,
    });

    return withCors(apiOk({ listing }, 201));
  } catch (e) {
    return withCors(handleApiError(e));
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
