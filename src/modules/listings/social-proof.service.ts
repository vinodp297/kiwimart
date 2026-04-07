// src/modules/listings/social-proof.service.ts
// ─── Listing Social Proof — real data, cached 5 min ─────────────────────────

import { unstable_cache } from "next/cache";
import { listingRepository } from "./listing.repository";
import { offerRepository } from "@/modules/offers/offer.repository";

export interface SocialProofData {
  viewCount: number; // last 7 days (from listing.viewCount for now)
  watcherCount: number;
  pendingOfferCount: number;
}

async function fetchSocialProof(listingId: string): Promise<SocialProofData> {
  const [listing, pendingOffers] = await Promise.all([
    listingRepository.findSocialProofCounts(listingId),
    offerRepository.countPendingByListing(listingId),
  ]);

  return {
    viewCount: listing?.viewCount ?? 0,
    watcherCount: listing?._count.watchers ?? 0,
    pendingOfferCount: pendingOffers,
  };
}

/**
 * Get social proof data for a listing. Cached 5 minutes.
 */
export const getListingSocialProof = unstable_cache(
  fetchSocialProof,
  ["listing-social-proof"],
  { revalidate: 300 },
);
