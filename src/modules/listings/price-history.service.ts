// src/modules/listings/price-history.service.ts
// ─── Listing Price History ──────────────────────────────────────────────────

import { unstable_cache } from "next/cache";
import { listingRepository } from "./listing.repository";

export interface PriceHistoryPoint {
  priceNzd: number; // cents
  changedAt: string; // ISO date
}

async function fetchPriceHistory(
  listingId: string,
): Promise<PriceHistoryPoint[]> {
  const rows = await listingRepository.findPriceHistory(listingId);

  return rows.map((r) => ({
    priceNzd: r.priceNzd,
    changedAt: r.changedAt.toISOString(),
  }));
}

/**
 * Get price history for a listing. Cached 30 minutes.
 */
export const getListingPriceHistory = unstable_cache(
  fetchPriceHistory,
  ["listing-price-history"],
  { revalidate: 1800 },
);
