// src/app/api/v1/listings/[id]/route.ts
// ─── Single Listing API ─────────────────────────────────────────────────────
// PATCH  /api/v1/listings/[id] — update a listing (owner only)
// DELETE /api/v1/listings/[id] — soft-delete a listing (owner or admin)

import { listingService } from "@/modules/listings/listing.service";
import { createListingSchema } from "@/server/validators";
import { toCents } from "@/lib/currency";
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
    if (data.price !== undefined) update.priceNzd = toCents(data.price);
    if (data.condition !== undefined) update.condition = data.condition;
    if (data.categoryId !== undefined) update.categoryId = data.categoryId;
    if (data.subcategoryName !== undefined)
      update.subcategoryName = data.subcategoryName;
    if (data.region !== undefined) update.region = data.region;
    if (data.suburb !== undefined) update.suburb = data.suburb;
    if (data.shippingOption !== undefined)
      update.shippingOption = data.shippingOption;
    if (data.shippingPrice !== undefined)
      update.shippingNzd = toCents(data.shippingPrice);
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

    const result = await listingService.patchListingViaApi(id, user.id, update);

    if (!result.ok) {
      return withCors(
        apiError(
          result.error,
          result.statusCode,
          result.statusCode === 404 ? "NOT_FOUND" : "FORBIDDEN",
        ),
        request.headers.get("origin"),
      );
    }

    return withCors(
      apiOk({ listing: result.listing }),
      request.headers.get("origin"),
    );
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

    await listingService.deleteListing(id, user.id, user.isAdmin);

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
