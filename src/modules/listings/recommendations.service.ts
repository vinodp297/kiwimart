// src/modules/listings/recommendations.service.ts
// ─── Smart Recommendations — rules-based, cached ────────────────────────────

import db from "@/lib/db";
import { unstable_cache } from "next/cache";
import { getImageUrl } from "@/lib/image";
import type { ListingCard, NZRegion } from "@/types";

const CONDITION_MAP: Record<string, ListingCard["condition"]> = {
  NEW: "new",
  LIKE_NEW: "like-new",
  GOOD: "good",
  FAIR: "fair",
  PARTS: "parts",
};

function mapListingRow(row: {
  id: string;
  title: string;
  priceNzd: number;
  condition: string;
  categoryId: string;
  subcategoryName: string | null;
  region: string;
  suburb: string;
  shippingOption: string;
  shippingNzd: number | null;
  isOffersEnabled: boolean;
  status: string;
  viewCount: number;
  watcherCount: number;
  createdAt: Date;
  images: { r2Key: string }[];
  seller: { displayName: string; username: string; idVerified: boolean };
}): ListingCard {
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

const LISTING_SELECT = {
  id: true,
  title: true,
  priceNzd: true,
  condition: true,
  categoryId: true,
  subcategoryName: true,
  region: true,
  suburb: true,
  shippingOption: true,
  shippingNzd: true,
  isOffersEnabled: true,
  status: true,
  viewCount: true,
  watcherCount: true,
  createdAt: true,
  images: {
    where: { order: 0, isSafe: true },
    select: { r2Key: true },
    take: 1,
  },
  seller: { select: { displayName: true, username: true, idVerified: true } },
} as const;

/**
 * A — "More from this seller" (listing detail page)
 */
export const getMoreFromSeller = unstable_cache(
  async (
    sellerId: string,
    excludeListingId: string,
  ): Promise<ListingCard[]> => {
    const rows = await db.listing.findMany({
      where: {
        sellerId,
        status: "ACTIVE",
        deletedAt: null,
        id: { not: excludeListingId },
      },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: LISTING_SELECT,
    });
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
    const minPrice = Math.round(priceNzd * 0.5);
    const maxPrice = Math.round(priceNzd * 1.5);

    const rows = await db.listing.findMany({
      where: {
        categoryId,
        status: "ACTIVE",
        deletedAt: null,
        id: { not: listingId },
        sellerId: { not: sellerId },
        priceNzd: { gte: minPrice, lte: maxPrice },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: LISTING_SELECT,
    });
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
    const rows = await db.listing.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: { watcherCount: "desc" },
      take: 12,
      select: LISTING_SELECT,
    });
    return rows.map(mapListingRow);
  },
  ["featured-listings"],
  { revalidate: 1800 },
);
