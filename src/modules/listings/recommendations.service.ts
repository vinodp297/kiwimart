// src/modules/listings/recommendations.service.ts
// ─── Smart Recommendations — rules-based, cached ────────────────────────────

import { unstable_cache } from "next/cache";
import { getImageUrl } from "@/lib/image";
import { listingRepository } from "./listing.repository";
import type { RecommendationRow } from "./listing.repository";
import type { ListingCard, NZRegion } from "@/types";

const CONDITION_MAP: Record<string, ListingCard["condition"]> = {
  NEW: "new",
  LIKE_NEW: "like-new",
  GOOD: "good",
  FAIR: "fair",
  PARTS: "parts",
};

function mapListingRow(row: RecommendationRow): ListingCard {
  return {
    id: row.id,
    title: row.title,
    price: row.priceNzd / 100,
    condition: CONDITION_MAP[row.condition] ?? "good",
    categoryName: row.categoryId,
    subcategoryName: row.subcategoryName ?? "",
    region: row.region as NZRegion,
    suburb: row.suburb,
    thumbnailUrl: getImageUrl(row.images[0]?.r2Key ?? null),
    sellerName: row.seller.displayName,
    sellerUsername: row.seller.username,
    sellerRating: 0,
    sellerVerified: row.seller.idVerified,
    viewCount: row.viewCount,
    watcherCount: row.watcherCount,
    createdAt: row.createdAt.toISOString(),
    status: row.status.toLowerCase() as ListingCard["status"],
    shippingOption:
      row.shippingOption.toLowerCase() as ListingCard["shippingOption"],
    shippingPrice: row.shippingNzd != null ? row.shippingNzd / 100 : null,
    isOffersEnabled: row.isOffersEnabled,
  };
}

/**
 * A — "More from this seller" (listing detail page)
 */
export const getMoreFromSeller = unstable_cache(
  async (
    sellerId: string,
    excludeListingId: string,
  ): Promise<ListingCard[]> => {
    const rows = await listingRepository.findMoreFromSeller(
      sellerId,
      excludeListingId,
    );
    return rows.map(mapListingRow);
  },
  ["more-from-seller"],
  { revalidate: 900 }, // 15 min
);

/**
 * B — "Similar listings" (listing detail page)
 */
export const getSimilarListings = unstable_cache(
  async (
    listingId: string,
    categoryId: string,
    priceNzd: number,
    sellerId: string,
  ): Promise<ListingCard[]> => {
    const rows = await listingRepository.findSimilarListings(
      listingId,
      categoryId,
      priceNzd,
      sellerId,
    );
    return rows.map(mapListingRow);
  },
  ["similar-listings"],
  { revalidate: 1800 }, // 30 min
);

/**
 * E — "Featured listings" (homepage) — Gold/Silver sellers first, then by watchers
 */
export const getFeaturedListings = unstable_cache(
  async (): Promise<ListingCard[]> => {
    const rows = await listingRepository.findFeaturedListings();
    return rows.map(mapListingRow);
  },
  ["featured-listings"],
  { revalidate: 1800 },
);
