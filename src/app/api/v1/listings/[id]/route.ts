// src/app/api/v1/listings/[id]/route.ts
// ─── Single Listing API ─────────────────────────────────────────────────────
// PATCH  /api/v1/listings/[id] — update a listing (owner only)
// DELETE /api/v1/listings/[id] — soft-delete a listing (owner or admin)

import db from "@/lib/db";
import { createListingSchema } from "@/server/validators";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";

const updateBodySchema = createListingSchema.partial();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await params;

    // Verify ownership
    const listing = await db.listing.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, sellerId: true, status: true },
    });

    if (!listing) {
      return withCors(
        apiError("Listing not found", 404, "NOT_FOUND"),
        request.headers.get("origin"),
      );
    }
    if (listing.sellerId !== user.id) {
      return withCors(
        apiError("Not your listing", 403, "FORBIDDEN"),
        request.headers.get("origin"),
      );
    }

    // Parse body
    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const parsed = updateBodySchema.safeParse(body);
    if (!parsed.success) {
      return withCors(
        apiError("Validation failed", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const data = parsed.data;

    // Build update payload — only include fields that were provided
    const update: Record<string, unknown> = {};
    if (data.title !== undefined) update.title = data.title;
    if (data.description !== undefined) update.description = data.description;
    if (data.price !== undefined)
      update.priceNzd = Math.round(data.price * 100);
    if (data.condition !== undefined) update.condition = data.condition;
    if (data.categoryId !== undefined) update.categoryId = data.categoryId;
    if (data.subcategoryName !== undefined)
      update.subcategoryName = data.subcategoryName;
    if (data.region !== undefined) update.region = data.region;
    if (data.suburb !== undefined) update.suburb = data.suburb;
    if (data.shippingOption !== undefined)
      update.shippingOption = data.shippingOption;
    if (data.shippingPrice !== undefined)
      update.shippingNzd = Math.round(data.shippingPrice * 100);
    if (data.isOffersEnabled !== undefined)
      update.isOffersEnabled = data.isOffersEnabled;
    if (data.isGstIncluded !== undefined)
      update.isGstIncluded = data.isGstIncluded;
    if (data.isUrgent !== undefined) update.isUrgent = data.isUrgent;
    if (data.isNegotiable !== undefined)
      update.isNegotiable = data.isNegotiable;
    if (data.shipsNationwide !== undefined)
      update.shipsNationwide = data.shipsNationwide;
    if (data.pickupAddress !== undefined)
      update.pickupAddress = data.pickupAddress;

    if (Object.keys(update).length === 0) {
      return withCors(
        apiError("No fields to update", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const updated = await db.listing.update({
      where: { id },
      data: update,
      select: {
        id: true,
        title: true,
        status: true,
        priceNzd: true,
        updatedAt: true,
      },
    });

    return withCors(apiOk({ listing: updated }), request.headers.get("origin"));
  } catch (e) {
    return withCors(handleApiError(e), request.headers.get("origin"));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await params;

    const listing = await db.listing.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, sellerId: true },
    });

    if (!listing) {
      return withCors(
        apiError("Listing not found", 404, "NOT_FOUND"),
        request.headers.get("origin"),
      );
    }
    if (listing.sellerId !== user.id && !user.isAdmin) {
      return withCors(
        apiError("Not your listing", 403, "FORBIDDEN"),
        request.headers.get("origin"),
      );
    }

    await db.listing.update({
      where: { id },
      data: { deletedAt: new Date(), status: "REMOVED" },
    });

    return withCors(
      apiOk({ message: "Listing deleted" }),
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
