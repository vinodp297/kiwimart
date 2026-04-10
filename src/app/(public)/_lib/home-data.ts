// src/app/(public)/_lib/home-data.ts
// ─── Homepage data-fetching and transformation ────────────────────────────────
// Isolated here so page.tsx stays thin and components receive plain props.
// All DB access goes through repositories — no direct db imports allowed here.

import { getImageUrl } from "@/lib/image";
import { getCached } from "@/server/lib/cache";
import { logger } from "@/shared/logger";
import CATEGORIES from "@/data/categories";
import LISTINGS from "@/data/listings";
import { listingRepository } from "@/modules/listings/listing.repository";
import { userRepository } from "@/modules/users/user.repository";
import type { ListingCard, Category } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HomeStat {
  value: string;
  label: string;
}

export interface HomePageData {
  stats: HomeStat[];
  visibleCategories: Category[];
  featured: ListingCard[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

const CONDITION_MAP: Record<string, string> = {
  NEW: "new",
  LIKE_NEW: "like-new",
  GOOD: "good",
  FAIR: "fair",
  PARTS: "parts",
};

// ── fetchHomeData ─────────────────────────────────────────────────────────────

export async function fetchHomeData(): Promise<HomePageData> {
  let listingCount: number | null = null;
  let memberCount: number | null = null;
  let featuredRows: Awaited<
    ReturnType<typeof listingRepository.findFeaturedListings>
  > | null = null;
  let categoryCounts: { categoryId: string; count: number }[] | null = null;

  try {
    const [counts, featured, catCounts] = await Promise.all([
      getCached(
        "stats:homepage",
        () =>
          Promise.all([
            listingRepository.countActive(),
            userRepository.countActive(),
          ]),
        300,
      ),
      listingRepository.findFeaturedListings(8),
      listingRepository.groupByCategory(),
    ]);

    [listingCount, memberCount] = counts;
    featuredRows = featured;
    categoryCounts = catCounts;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("homepage.data_fetch_failed", {
      error: message,
      component: "homepage",
      severity: "degraded",
    });

    import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureException(error, {
          tags: { component: "homepage", severity: "degraded" },
          level: "warning",
        });
      })
      .catch(() => {
        // Sentry unavailable — structured log above still records the failure
      });

    // Variables remain: listingCount = null, memberCount = null,
    // featuredRows = null, categoryCounts = null — fallback to mock data.
  }

  // ── Build stats ─────────────────────────────────────────────────────────────
  const stats: HomeStat[] = [
    {
      value: listingCount != null ? formatCount(listingCount) : "248K",
      label: "Active listings",
    },
    {
      value: memberCount != null ? formatCount(memberCount) : "1.2M",
      label: "Members",
    },
    { value: "$3K", label: "Buyer protection" },
    { value: "$0", label: "Listing fee" },
  ];

  // ── Build visible categories ────────────────────────────────────────────────
  const countMap = categoryCounts
    ? Object.fromEntries(categoryCounts.map((c) => [c.categoryId, c.count]))
    : {};

  const visibleCategories = CATEGORIES.map((cat) => ({
    ...cat,
    listingCount: countMap[cat.id] ?? cat.listingCount,
  })).slice(0, 8);

  // ── Build featured listings ─────────────────────────────────────────────────
  const featured: ListingCard[] = featuredRows
    ? featuredRows.map((row) => ({
        id: row.id,
        title: row.title,
        price: row.priceNzd / 100,
        condition: (CONDITION_MAP[row.condition] ??
          "good") as ListingCard["condition"],
        categoryName: row.categoryId,
        subcategoryName: row.subcategoryName ?? "",
        region: row.region as ListingCard["region"],
        suburb: row.suburb ?? "",
        thumbnailUrl: getImageUrl(row.images[0]?.r2Key) ?? "",
        sellerName: row.seller.displayName,
        sellerUsername: row.seller.username,
        sellerRating: 4.5,
        sellerVerified: false,
        viewCount: row.viewCount,
        watcherCount: row.watcherCount,
        createdAt: row.createdAt.toISOString(),
        status: row.status.toLowerCase() as ListingCard["status"],
        shippingOption:
          row.shippingOption.toLowerCase() as ListingCard["shippingOption"],
        shippingPrice: row.shippingNzd != null ? row.shippingNzd / 100 : null,
        isOffersEnabled: row.isOffersEnabled,
      }))
    : [...LISTINGS].sort((a, b) => b.watcherCount - a.watcherCount).slice(0, 8);

  return { stats, visibleCategories, featured };
}
