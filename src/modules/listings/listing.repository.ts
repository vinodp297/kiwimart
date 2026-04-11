// src/modules/listings/listing.repository.ts
// ─── Listing Repository — data access only, no business logic ───────────────

import db, { getClient, type DbClient } from "@/lib/db";
export type { DbClient };
import { fireAndForget } from "@/lib/fire-and-forget";
import { MS_PER_DAY } from "@/lib/time";
import { Prisma } from "@prisma/client";
import type { ListingStatus } from "@prisma/client";

// ── Shared select shape for recommendation queries ──────────────────────────
// Matches the LISTING_SELECT used in recommendations.service.ts.
const RECOMMENDATION_SELECT = {
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

export const listingRepository = {
  // ── Service-layer methods (wired in listing.service.ts) ─────────────────

  async findByIdForDelete(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id },
      select: { id: true, sellerId: true, status: true, title: true },
    });
  },

  async softDelete(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.update({
      where: { id },
      data: { deletedAt: new Date(), status: "REMOVED" },
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

  /** Fire-and-forget view count increment */
  incrementViewCount(id: string) {
    fireAndForget(
      db.listing.update({
        where: { id },
        data: { viewCount: { increment: 1 } },
      }),
      "listing.incrementViewCount",
      { listingId: id },
    );
  },

  // ── Watchlist ─────────────────────────────────────────────────────────────

  async findWatchlistItem(userId: string, listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.watchlistItem.findUnique({
      where: { userId_listingId: { userId, listingId } },
    });
  },

  async removeWatch(userId: string, listingId: string) {
    await db.$transaction([
      db.watchlistItem.delete({
        where: { userId_listingId: { userId, listingId } },
      }),
      db.listing.update({
        where: { id: listingId },
        data: { watcherCount: { decrement: 1 } },
      }),
    ]);
  },

  async addWatch(userId: string, listingId: string) {
    await db.$transaction([
      db.watchlistItem.create({ data: { userId, listingId } }),
      db.listing.update({
        where: { id: listingId },
        data: { watcherCount: { increment: 1 } },
      }),
    ]);
  },

  // ── Phase 2B methods (wired from server actions) ───────────────────────

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

  async reserveAtomically(
    id: string,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "RESERVED" },
    });
  },

  async releaseReservation(
    id: string,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  /** Restore a SOLD listing to ACTIVE (after an auto-refund dispute resolution).
   * Uses updateMany so a status mismatch is a no-op rather than an error. */
  async restoreFromSold(id: string): Promise<void> {
    await db.listing.updateMany({
      where: { id, status: "SOLD" },
      data: { status: "ACTIVE" },
    });
  },

  async updateListing(
    id: string,
    data: Prisma.ListingUncheckedUpdateInput,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.listing.update({ where: { id }, data });
  },

  async create(data: Prisma.ListingUncheckedCreateInput, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.create({ data, select: { id: true } });
  },

  async countBySeller(sellerId: string, tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listing.count({
      where: { sellerId, status: "ACTIVE", deletedAt: null },
    });
  },

  /**
   * Count seller's listings (excluding the listing being reviewed) across the
   * statuses that consume an "active slot" — used by the L1 listing limit
   * enforcement in auto-review.
   */
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

  /**
   * Mark a listing SOLD with soldAt = now — used by auto-complete flows
   * (delivery-reminder cron, autoReleaseEscrow). Caller must already have
   * verified the order transition.
   */
  async markSold(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.update({
      where: { id },
      data: { status: "SOLD", soldAt: new Date() },
    });
  },

  /**
   * Bulk-expire ACTIVE listings whose expiresAt has passed. Used by the
   * daily expireListings cron. Status guard `ACTIVE` makes the update safe
   * against listings that were already SOLD/RESERVED in a race.
   */
  async expireActivePast(
    now: Date,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lt: now },
        deletedAt: null,
      },
      data: { status: "EXPIRED" },
    });
  },

  /**
   * Release listings whose 10-minute checkout reservation has lapsed (Fix 10).
   * Used by /api/cron/release-stale-reservations.
   *
   * Returns the number of listings restored to ACTIVE so the cron can log it.
   * The compound `status + reservedUntil` index makes this a fast scan.
   */
  async releaseStaleReservations(
    now: Date,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: {
        status: "RESERVED",
        reservedUntil: { lt: now },
      },
      data: { status: "ACTIVE", reservedUntil: null },
    });
  },

  /**
   * Bulk-release listings from RESERVED back to ACTIVE — used by the
   * release-expired-offer-reservations cron. The status guard ensures we
   * never overwrite a listing that has since been re-reserved.
   */
  async bulkReleaseFromReserved(
    listingIds: string[],
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id: { in: listingIds }, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  /**
   * Count listings created by a seller since the given timestamp — used by
   * the spam detection layer to flag listing-velocity attacks.
   */
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

  /**
   * Count how many of a seller's non-deleted listings share an exact title —
   * used by spam detection to catch duplicate-content uploads.
   */
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

  /**
   * Find a recent listing from the same seller whose title starts with the
   * given prefix — used by auto-review's duplicate detection. Returns just
   * the id (caller only needs to know if a duplicate exists).
   */
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

  async reorderImages(listingId: string, orderedIds: string[], tx?: DbClient) {
    const client = getClient(tx);
    await Promise.all(
      orderedIds.map((id, i) =>
        client.listingImage.update({ where: { id }, data: { order: i } }),
      ),
    );
  },

  async reactivate(id: string, tx?: DbClient): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  /** Set listing status directly (admin remove, offer accept → RESERVED, dispute → ACTIVE). */
  async setStatus(id: string, status: ListingStatus, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.update({ where: { id }, data: { status } });
  },

  /** Fetch active listing data needed for offer creation. */
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

  // ── Draft methods ─────────────────────────────────────────────────────────

  async findByIdForDraftUpdate(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.findUnique({
      where: { id },
      select: { sellerId: true, status: true, deletedAt: true },
    });
  },

  async disconnectDraftImages(listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listingImage.updateMany({
      where: { listingId },
      data: { listingId: null },
    });
  },

  async associateImageByKey(
    r2Key: string,
    listingId: string,
    order: number,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.listingImage.updateMany({
      where: { r2Key },
      data: { listingId, order },
    });
  },

  // ── Edit/Update methods ───────────────────────────────────────────────────

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

  /**
   * Update a listing with an optimistic lock on updatedAt.
   *
   * The WHERE clause includes the last-known updatedAt so that a concurrent
   * write (which bumps updatedAt) causes this UPDATE to match 0 rows.
   * Callers must check result.count — 0 means another process modified the
   * record first (or it was deleted), and should surface CONCURRENT_MODIFICATION
   * or NOT_FOUND accordingly.
   *
   * Note: Prisma does not auto-bump @updatedAt in updateMany, so we set it
   * explicitly.
   */
  async updateListingOptimistic(
    id: string,
    data: Prisma.ListingUncheckedUpdateInput,
    expectedUpdatedAt: Date,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = getClient(tx);
    return client.listing.updateMany({
      where: { id, updatedAt: expectedUpdatedAt },
      data: { ...data, updatedAt: new Date() },
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

  // ── Seller enable ─────────────────────────────────────────────────────────

  async enableSeller(userId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.user.update({
      where: { id: userId },
      data: { isSellerEnabled: true },
    });
  },

  // ── Price history ─────────────────────────────────────────────────────────

  createPriceHistory(listingId: string, priceNzd: number) {
    fireAndForget(
      db.listingPriceHistory.create({ data: { listingId, priceNzd } }),
      "listing.createPriceHistory",
      { listingId, priceNzd },
    );
  },

  // ── Trust metrics (for auto-review) ───────────────────────────────────────

  async findTrustMetrics(userId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.trustMetrics.findUnique({
      where: { userId },
      select: { isFlaggedForFraud: true, disputeRate: true },
    });
  },

  // ── Watchlist price alerts ────────────────────────────────────────────────

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

  // ── Browse listings (public paginated feed) ───────────────────────────────

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

  // ── Price history ─────────────────────────────────────────────────────────

  /** Fetch price-change history for a listing, ordered oldest-first. */
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

  // ── Social proof ──────────────────────────────────────────────────────────

  /** Fetch viewCount and watcher count for social-proof display. */
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

  // ── Recommendations ───────────────────────────────────────────────────────

  /** Fetch other active listings from the same seller (listing detail page). */
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

  /** Fetch listings in the same category at a similar price point. */
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

  /** Fetch featured active listings sorted by watcher count (homepage). */
  async findFeaturedListings(limit = 12) {
    return db.listing.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: { watcherCount: "desc" },
      take: limit,
      select: RECOMMENDATION_SELECT,
    });
  },

  /** Count all active (published) listings — used for homepage stats strip. */
  async countActive(): Promise<number> {
    return db.listing.count({ where: { status: "ACTIVE", deletedAt: null } });
  },

  /** Group active listings by categoryId — used for homepage category pills. */
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

  /** Full-text search for listing IDs using Postgres tsvector.
   *  Capped at MAX_SEARCH_RESULTS to prevent unbounded memory growth on common
   *  keywords. The service paginates within this result set. */
  async searchByVector(query: string): Promise<{ id: string }[]> {
    const MAX_SEARCH_RESULTS = 1000;
    return db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Listing"
      WHERE "searchVector" @@ plainto_tsquery('english', ${query})
        AND status = 'ACTIVE'
        AND "deletedAt" IS NULL
      ORDER BY ts_rank("searchVector", plainto_tsquery('english', ${query})) DESC
      LIMIT ${MAX_SEARCH_RESULTS}
    `;
  },

  /** Count listings matching the search filter. */
  async countSearch(where: Prisma.ListingWhereInput): Promise<number> {
    return db.listing.count({ where });
  },

  /** Fetch listing rows for search results. */
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

  // ── Admin listing moderation ──────────────────────────────────────────────

  /** Fetch listing fields needed for all three moderation actions (approve / request changes / reject). */
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

  /** Set listing to ACTIVE with published/expiry timestamps (admin approve). */
  async approveListing(listingId: string, adminId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.listing.update({
      where: { id: listingId },
      data: {
        status: "ACTIVE",
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * MS_PER_DAY),
        moderatedBy: adminId,
        moderatedAt: new Date(),
        moderationNote: null,
      },
    });
  },

  /** Set listing to NEEDS_CHANGES with a moderation note. */
  async requestChanges(
    listingId: string,
    adminId: string,
    note: string,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.listing.update({
      where: { id: listingId },
      data: {
        status: "NEEDS_CHANGES",
        moderatedBy: adminId,
        moderatedAt: new Date(),
        moderationNote: note,
      },
    });
  },

  /** Set listing to REMOVED with a rejection reason. */
  async rejectListing(
    listingId: string,
    adminId: string,
    reason: string,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.listing.update({
      where: { id: listingId },
      data: {
        status: "REMOVED",
        moderatedBy: adminId,
        moderatedAt: new Date(),
        moderationNote: reason,
      },
    });
  },

  /** Fetch PENDING_REVIEW listings for the admin moderation queue. */
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

  /** Fetch NEEDS_CHANGES listings for the admin moderation queue. */
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

  /** Count listings currently awaiting first review. */
  async countPendingReview(tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listing.count({
      where: { status: "PENDING_REVIEW", deletedAt: null },
    });
  },

  /** Count listings currently awaiting seller changes. */
  async countNeedsChanges(tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.listing.count({
      where: { status: "NEEDS_CHANGES", deletedAt: null },
    });
  },

  /** Count listings approved (or published) within the last 24 hours. */
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

  // ── Transaction ───────────────────────────────────────────────────────────

  async $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return db.$transaction(fn);
  },
};
