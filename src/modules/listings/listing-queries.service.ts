// src/modules/listings/listing-queries.service.ts
// ─── Read-only listing operations ───────────────────────────────────────────

import { listingRepository } from "./listing.repository";

// ── getBrowseListings ───────────────────────────────────────────────────────

export async function getBrowseListings(params: {
  q?: string;
  category?: string;
  cursor?: string;
  limit: number;
}) {
  return listingRepository.findBrowseListings(params);
}

// ── getListingForEdit ───────────────────────────────────────────────────────

export async function getListingForEdit(
  listingId: string,
  userId: string,
  isAdmin: boolean,
) {
  const listing = await listingRepository.findByIdForEdit(listingId);

  if (!listing || listing.deletedAt) {
    return { ok: false as const, error: "Listing not found." };
  }
  if (listing.sellerId !== userId && !isAdmin) {
    return {
      ok: false as const,
      error: "You don't have permission to edit this listing.",
    };
  }

  return {
    ok: true as const,
    data: {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      priceNzd: listing.priceNzd,
      isGstIncluded: listing.isGstIncluded,
      condition: listing.condition,
      status: listing.status,
      moderationNote: listing.moderationNote,
      categoryId: listing.categoryId,
      subcategoryName: listing.subcategoryName,
      region: listing.region,
      suburb: listing.suburb,
      shippingOption: listing.shippingOption,
      shippingNzd: listing.shippingNzd,
      isOffersEnabled: listing.isOffersEnabled,
      isUrgent: listing.isUrgent,
      isNegotiable: listing.isNegotiable,
      shipsNationwide: listing.shipsNationwide,
      images: listing.images,
    },
  };
}
