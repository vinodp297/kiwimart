// src/modules/listings/listing-engagement.service.ts
// ─── Watchlist and view tracking ────────────────────────────────────────────

import { AppError } from "@/shared/errors";
import { getCached } from "@/server/lib/cache";
import { SECONDS_PER_MINUTE } from "@/lib/time";
import { listingRepository } from "./listing.repository";

export const LISTING_DETAIL_CACHE_TTL = SECONDS_PER_MINUTE * 5;
export function listingDetailKey(id: string) {
  return `listings:detail:${id}`;
}

// ── toggleWatch ─────────────────────────────────────────────────────────────

export async function toggleWatch(
  listingId: string,
  userId: string,
): Promise<{ watching: boolean }> {
  const existing = await listingRepository.findWatchlistItem(userId, listingId);

  if (existing) {
    await listingRepository.removeWatch(userId, listingId);
    return { watching: false };
  }

  const listing = await listingRepository.findByIdActive(listingId);
  if (!listing) throw AppError.notFound("Listing");

  if (listing.sellerId === userId) {
    throw new AppError(
      "INVALID_OPERATION",
      "You cannot add your own listing to your watchlist.",
      400,
    );
  }

  await listingRepository.addWatch(userId, listingId);
  return { watching: true };
}

// ── getListingById ──────────────────────────────────────────────────────────

export async function getListingById(id: string) {
  const listing = await getCached(
    listingDetailKey(id),
    () => listingRepository.findByIdWithSellerAndImages(id),
    LISTING_DETAIL_CACHE_TTL,
  );

  if (!listing) return null;

  // Increment view count (fire-and-forget — does not affect cached data)
  listingRepository.incrementViewCount(id);

  return listing;
}
