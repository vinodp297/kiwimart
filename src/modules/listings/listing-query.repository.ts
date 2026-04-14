// src/modules/listings/listing-query.repository.ts
// ─── All findXxx, searchXxx, countXxx for real-time flows ─────────────────────

import db, { getClient, type DbClient } from "@/lib/db";
import { MS_PER_DAY } from "@/lib/time";
import { Prisma } from "@prisma/client";

// ── Shared select shape for recommendation queries ──────────────────────────
export const RECOMMENDATION_SELECT = {
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

export type RecommendationRow = Prisma.ListingGetPayload<{
  select: typeof RECOMMENDATION_SELECT;
}>;

export type ListingWithRelations = Prisma.ListingGetPayload<{
  include: {
    seller: {
      select: { id: true; displayName: true; username: true; avatarKey: true };
    };
    images: true;
    attrs: true;
  };
}>;

export type ListingWithImages = Prisma.ListingGetPayload<{
  include: { images: true };
}>;

export type SitemapListing = { id: string; updatedAt: Date };
export type SitemapSeller = { username: string | null; updatedAt: Date };

/** Fetch active listing IDs + timestamps for sitemap generation (max 1 000). */
export async function getSitemapListings(): Promise<SitemapListing[]> {
  return db.listing.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, updatedAt: true },
    orderBy: { watcherCount: "desc" },
    take: 1000,
  });
}

/** Fetch enabled-seller usernames + timestamps for sitemap generation. */
export async function getSitemapSellers(): Promise<SitemapSeller[]> {
  return db.user.findMany({
    where: { isSellerEnabled: true, isBanned: false },
    select: { username: true, updatedAt: true },
  });
}

export const listingQueryRepository = {
  async findByIdForDelete(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id },
      select: { id: true, sellerId: true, status: true, title: true },
    });
  },

  async findByIdActive(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id, status: "ACTIVE", deletedAt: null },
      select: { id: true, sellerId: true },
    });
  },

  async findByIdWithSellerAndImages(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: {
        id,
        status: { in: ["ACTIVE", "RESERVED", "SOLD"] },
        deletedAt: null,
      },
      include: {
        seller: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarKey: true,
            bio: true,
            region: true,
            suburb: true,
            idVerified: true,
            createdAt: true,
            _count: {
              select: {
                sellerOrders: { where: { status: "COMPLETED" } },
                listings: { where: { status: "ACTIVE" } },
                reviewsAbout: {
                  where: { reviewerRole: "BUYER", isApproved: true },
                },
              },
            },
            reviewsAbout: {
              where: { reviewerRole: "BUYER", isApproved: true },
              select: { rating: true },
            },
          },
        },
        images: { orderBy: { order: "asc" } },
        attrs: { orderBy: { order: "asc" } },
      },
    });
  },

  async findWatchlistItem(userId: string, listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.watchlistItem.findUnique({
      where: { userId_listingId: { userId, listingId } },
    });
  },

  async findByIdWithRelations(
    id: string,
    tx?: DbClient,
  ): Promise<ListingWithRelations | null> {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id },
      include: {
        seller: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarKey: true,
          },
        },
        images: true,
        attrs: true,
      },
    }) as Promise<ListingWithRelations | null>;
  },

  async findByIdForPurchase(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id },
      select: {
        id: true,
        sellerId: true,
        status: true,
        priceNzd: true,
        shippingNzd: true,
        shippingOption: true,
        title: true,
        deletedAt: true,
      },
    });
  },

  async findCategoryById(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.category.findUnique({
      where: { id },
      select: { id: true },
    });
  },

  async findImagesByListingId(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listingImage.findMany({
      where: { listingId },
      select: {
        id: true,
        r2Key: true,
        isSafe: true,
        isScanned: true,
        thumbnailKey: true,
        order: true,
      },
    });
  },

  async findImagesByKeys(r2Keys: string[], tx?: DbClient) {
    const client = getClient(tx);
    return client.listingImage.findMany({
      where: { r2Key: { in: r2Keys } },
      select: { id: true, r2Key: true, isScanned: true, isSafe: true },
    });
  },

  async findForOffer(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id, status: "ACTIVE", deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        title: true,
        priceNzd: true,
        isOffersEnabled: true,
        seller: { select: { email: true, displayName: true } },
      },
    });
  },

  async findByIdForDraftUpdate(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id },
      select: { sellerId: true, status: true, deletedAt: true },
    });
  },

  async findByIdForUpdate(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id },
      select: {
        sellerId: true,
        priceNzd: true,
        deletedAt: true,
        title: true,
        description: true,
        categoryId: true,
        status: true,
        updatedAt: true,
      },
    });
  },

  async findByIdForEdit(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id },
      select: {
        id: true,
        sellerId: true,
        title: true,
        description: true,
        priceNzd: true,
        isGstIncluded: true,
        condition: true,
        status: true,
        moderationNote: true,
        categoryId: true,
        subcategoryName: true,
        region: true,
        suburb: true,
        shippingOption: true,
        shippingNzd: true,
        isOffersEnabled: true,
        isUrgent: true,
        isNegotiable: true,
        shipsNationwide: true,
        deletedAt: true,
        images: {
          orderBy: { order: "asc" as const },
          select: { id: true, r2Key: true, thumbnailKey: true, order: true },
        },
      },
    });
  },

  async findWatchersWithPriceAlert(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.watchlistItem.findMany({
      where: { listingId, isPriceAlertEnabled: true },
      select: {
        userId: true,
        user: { select: { email: true, displayName: true } },
      },
    });
  },

  async findBrowseListings(params: {
    q?: string;
    category?: string;
    cursor?: string;
    limit: number;
  }) {
    const { q, category, cursor, limit } = params;

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
          where: { order: 0, isSafe: true },
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

    return { listings, nextCursor, hasMore };
  },

  async findPriceHistory(
    listingId: string,
  ): Promise<{ priceNzd: number; changedAt: Date }[]> {
    return db.listingPriceHistory.findMany({
      where: { listingId },
      orderBy: { changedAt: "asc" },
      take: 50,
      select: { priceNzd: true, changedAt: true },
    });
  },

  async findSocialProofCounts(listingId: string): Promise<{
    viewCount: number;
    _count: { watchers: number };
  } | null> {
    return db.listing.findUnique({
      where: { id: listingId },
      select: {
        viewCount: true,
        _count: { select: { watchers: true } },
      },
    });
  },

  async findMoreFromSeller(sellerId: string, excludeListingId: string) {
    return db.listing.findMany({
      where: {
        sellerId,
        status: "ACTIVE",
        deletedAt: null,
        id: { not: excludeListingId },
      },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: RECOMMENDATION_SELECT,
    });
  },

  async findSimilarListings(
    listingId: string,
    categoryId: string,
    priceNzd: number,
    sellerId: string,
  ) {
    const minPrice = Math.round(priceNzd * 0.5);
    const maxPrice = Math.round(priceNzd * 1.5);
    return db.listing.findMany({
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
      select: RECOMMENDATION_SELECT,
    });
  },

  async findFeaturedListings(limit = 12) {
    return db.listing.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: { watcherCount: "desc" },
      take: limit,
      select: RECOMMENDATION_SELECT,
    });
  },

  async countActive(): Promise<number> {
    return db.listing.count({ where: { status: "ACTIVE", deletedAt: null } });
  },

  async groupByCategory(): Promise<{ categoryId: string; count: number }[]> {
    const rows = await db.listing.groupBy({
      by: ["categoryId"],
      where: { status: "ACTIVE", deletedAt: null },
      _count: { id: true },
    });
    return rows.map((r) => ({
      categoryId: r.categoryId,
      count: (r._count as { id?: number })?.id ?? 0,
    }));
  },

  /**
   * Return ts_rank-ordered listing IDs from the full-text search index.
   * Pagination is pushed into SQL so callers never load unbounded ID arrays
   * into memory. Pass skip=0, take=MAX for bulk ID-collection paths.
   */
  async searchByVector(
    query: string,
    skip: number,
    take: number,
  ): Promise<{ id: string }[]> {
    return db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Listing"
      WHERE "searchVector" @@ plainto_tsquery('english', ${query})
        AND status = 'ACTIVE'
        AND "deletedAt" IS NULL
      ORDER BY ts_rank("searchVector", plainto_tsquery('english', ${query})) DESC
      LIMIT ${take} OFFSET ${skip}
    `;
  },

  /**
   * Total count of FTS-matching active listings — used with searchByVector
   * for DB-level pagination so the service never loads all IDs into memory.
   */
  async countByVector(query: string): Promise<number> {
    const result = await db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM "Listing"
      WHERE "searchVector" @@ plainto_tsquery('english', ${query})
        AND status = 'ACTIVE'
        AND "deletedAt" IS NULL
    `;
    return Number(result[0]?.count ?? 0);
  },

  async countSearch(where: Prisma.ListingWhereInput): Promise<number> {
    return db.listing.count({ where });
  },

  async findSearchResults(
    where: Prisma.ListingWhereInput,
    orderBy: Prisma.ListingOrderByWithRelationInput,
    skip: number,
    take: number,
  ) {
    return db.listing.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
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
        isUrgent: true,
        isNegotiable: true,
        shipsNationwide: true,
        previousPriceNzd: true,
        priceDroppedAt: true,
        status: true,
        viewCount: true,
        watcherCount: true,
        createdAt: true,
        locationLat: true,
        locationLng: true,
        images: {
          where: { order: 0, isSafe: true },
          select: { r2Key: true, thumbnailKey: true },
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
  },

  async findForModeration(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        status: true,
        sellerId: true,
        deletedAt: true,
        seller: { select: { email: true, displayName: true } },
      },
    });
  },

  async findPendingReview(tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findMany({
      where: { status: "PENDING_REVIEW", deletedAt: null },
      orderBy: [{ autoRiskScore: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        priceNzd: true,
        autoRiskScore: true,
        autoRiskFlags: true,
        resubmissionCount: true,
        createdAt: true,
        status: true,
        seller: {
          select: {
            id: true,
            displayName: true,
            email: true,
            isPhoneVerified: true,
            idVerified: true,
          },
        },
        images: {
          orderBy: { order: "asc" },
          take: 1,
          select: { r2Key: true, thumbnailKey: true },
        },
      },
    });
  },

  async findNeedsChanges(tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findMany({
      where: { status: "NEEDS_CHANGES", deletedAt: null },
      orderBy: { moderatedAt: "desc" },
      select: {
        id: true,
        title: true,
        priceNzd: true,
        autoRiskScore: true,
        autoRiskFlags: true,
        moderationNote: true,
        moderatedAt: true,
        createdAt: true,
        status: true,
        seller: {
          select: {
            id: true,
            displayName: true,
            email: true,
            isPhoneVerified: true,
            idVerified: true,
          },
        },
        images: {
          orderBy: { order: "asc" },
          take: 1,
          select: { r2Key: true, thumbnailKey: true },
        },
      },
    });
  },

  async countPendingReview(tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listing.count({
      where: { status: "PENDING_REVIEW", deletedAt: null },
    });
  },

  async countNeedsChanges(tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listing.count({
      where: { status: "NEEDS_CHANGES", deletedAt: null },
    });
  },

  async countApprovedToday(tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    const since = new Date(Date.now() - MS_PER_DAY);
    return client.listing.count({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        OR: [{ moderatedAt: { gte: since } }, { publishedAt: { gte: since } }],
      },
    });
  },

  async findForNewMessage(id: string) {
    return db.listing.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        priceNzd: true,
        status: true,
        seller: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarKey: true,
          },
        },
        images: {
          orderBy: { order: "asc" as const },
          select: { r2Key: true },
          take: 1,
        },
      },
    });
  },

  async findForCheckout(id: string) {
    return db.listing.findUnique({
      where: { id, status: "ACTIVE", deletedAt: null },
      select: {
        id: true,
        title: true,
        priceNzd: true,
        shippingNzd: true,
        shippingOption: true,
        region: true,
        suburb: true,
        sellerId: true,
        condition: true,
        seller: {
          select: {
            displayName: true,
            username: true,
            stripeAccountId: true,
            isStripeOnboarded: true,
          },
        },
        images: {
          where: { order: 0 },
          select: { r2Key: true },
          take: 1,
        },
      },
    });
  },

  async findActiveBySellerForProfile(sellerId: string) {
    return db.listing.findMany({
      where: { sellerId, status: "ACTIVE", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: {
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
      },
    });
  },

  async findTrustMetrics(userId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.trustMetrics.findUnique({
      where: { userId },
      select: { isFlaggedForFraud: true, disputeRate: true },
    });
  },

  async findRecentDuplicateBySeller(
    params: {
      sellerId: string;
      excludeListingId: string;
      titlePrefix: string;
      since: Date;
    },
    tx?: DbClient,
  ): Promise<{ id: string } | null> {
    const client = getClient(tx);
    return client.listing.findFirst({
      where: {
        id: { not: params.excludeListingId },
        sellerId: params.sellerId,
        title: { startsWith: params.titlePrefix, mode: "insensitive" },
        status: { notIn: ["REMOVED"] },
        createdAt: { gte: params.since },
        deletedAt: null,
      },
      select: { id: true },
    });
  },

  async countBySeller(sellerId: string, tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listing.count({
      where: { sellerId, status: "ACTIVE", deletedAt: null },
    });
  },

  async countActiveSlotsForSellerExcluding(
    sellerId: string,
    excludeListingId: string,
    tx?: DbClient,
  ): Promise<number> {
    const client = getClient(tx);
    return client.listing.count({
      where: {
        sellerId,
        id: { not: excludeListingId },
        status: { in: ["ACTIVE", "PENDING_REVIEW", "NEEDS_CHANGES"] },
        deletedAt: null,
      },
    });
  },

  async countRecentBySeller(
    sellerId: string,
    since: Date,
    tx?: DbClient,
  ): Promise<number> {
    const client = getClient(tx);
    return client.listing.count({
      where: { sellerId, createdAt: { gte: since } },
    });
  },

  async countByExactTitle(
    sellerId: string,
    title: string,
    tx?: DbClient,
  ): Promise<number> {
    const client = getClient(tx);
    return client.listing.count({
      where: { sellerId, title, deletedAt: null },
    });
  },
};
