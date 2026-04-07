// src/modules/listings/listing.repository.ts
// ─── Listing Repository — data access only, no business logic ───────────────

import db from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { ListingStatus } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

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
    const client = tx ?? db;
    return client.listing.findUnique({
      where: { id },
      select: { id: true, sellerId: true, status: true, title: true },
    });
  },

  async softDelete(id: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.update({
      where: { id },
      data: { deletedAt: new Date(), status: "REMOVED" },
    });
  },

  async findByIdActive(id: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.findUnique({
      where: { id, status: "ACTIVE", deletedAt: null },
      select: { id: true, sellerId: true },
    });
  },

  async findByIdWithSellerAndImages(id: string, tx?: DbClient) {
    const client = tx ?? db;
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
    db.listing
      .update({ where: { id }, data: { viewCount: { increment: 1 } } })
      .catch(() => {});
  },

  // ── Watchlist ─────────────────────────────────────────────────────────────

  async findWatchlistItem(userId: string, listingId: string, tx?: DbClient) {
    const client = tx ?? db;
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
    const client = tx ?? db;
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
    const client = tx ?? db;
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
    const client = tx ?? db;
    return client.listing.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "RESERVED" },
    });
  },

  async releaseReservation(
    id: string,
    tx?: DbClient,
  ): Promise<Prisma.BatchPayload> {
    const client = tx ?? db;
    return client.listing.updateMany({
      where: { id, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  async updateListing(
    id: string,
    data: Prisma.ListingUncheckedUpdateInput,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.listing.update({ where: { id }, data });
  },

  async create(data: Prisma.ListingUncheckedCreateInput, tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.create({ data, select: { id: true } });
  },

  async countBySeller(sellerId: string, tx?: DbClient): Promise<number> {
    const client = tx ?? db;
    return client.listing.count({
      where: { sellerId, status: "ACTIVE", deletedAt: null },
    });
  },

  async findCategoryById(id: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.category.findUnique({
      where: { id },
      select: { id: true },
    });
  },

  async findImagesByListingId(listingId: string, tx?: DbClient) {
    const client = tx ?? db;
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
    const client = tx ?? db;
    return client.listingImage.findMany({
      where: { r2Key: { in: r2Keys } },
      select: { id: true, r2Key: true, isScanned: true, isSafe: true },
    });
  },

  async reorderImages(listingId: string, orderedIds: string[], tx?: DbClient) {
    const client = tx ?? db;
    await Promise.all(
      orderedIds.map((id, i) =>
        client.listingImage.update({ where: { id }, data: { order: i } }),
      ),
    );
  },

  async reactivate(id: string, tx?: DbClient): Promise<Prisma.BatchPayload> {
    const client = tx ?? db;
    return client.listing.updateMany({
      where: { id, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
  },

  /** Set listing status directly (admin remove, offer accept → RESERVED, dispute → ACTIVE).
   * @source src/modules/admin/admin.service.ts, src/modules/offers/offer.service.ts */
  async setStatus(id: string, status: ListingStatus, tx?: DbClient) {
    const client = tx ?? db;
    return client.listing.update({ where: { id }, data: { status } });
  },

  /** Fetch active listing data needed for offer creation.
   * @source src/modules/offers/offer.service.ts — createOffer */
  async findForOffer(id: string, tx?: DbClient) {
    const client = tx ?? db;
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
    const client = tx ?? db;
    return client.listing.findUnique({
      where: { id },
      select: { sellerId: true, status: true, deletedAt: true },
    });
  },

  async disconnectDraftImages(listingId: string, tx?: DbClient) {
    const client = tx ?? db;
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
    const client = tx ?? db;
    return client.listingImage.updateMany({
      where: { r2Key },
      data: { listingId, order },
    });
  },

  // ── Edit/Update methods ───────────────────────────────────────────────────

  async findByIdForUpdate(id: string, tx?: DbClient) {
    const client = tx ?? db;
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
    const client = tx ?? db;
    return client.listing.updateMany({
      where: { id, updatedAt: expectedUpdatedAt },
      data: { ...data, updatedAt: new Date() },
    });
  },

  async findByIdForEdit(id: string, tx?: DbClient) {
    const client = tx ?? db;
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
    const client = tx ?? db;
    return client.user.update({
      where: { id: userId },
      data: { isSellerEnabled: true },
    });
  },

  // ── Price history ─────────────────────────────────────────────────────────

  createPriceHistory(listingId: string, priceNzd: number) {
    db.listingPriceHistory
      .create({ data: { listingId, priceNzd } })
      .catch(() => {});
  },

  // ── Trust metrics (for auto-review) ───────────────────────────────────────

  async findTrustMetrics(userId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.trustMetrics.findUnique({
      where: { userId },
      select: { isFlaggedForFraud: true, disputeRate: true },
    });
  },

  // ── Watchlist price alerts ────────────────────────────────────────────────

  async findWatchersWithPriceAlert(listingId: string, tx?: DbClient) {
    const client = tx ?? db;
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

  // ── Transaction ───────────────────────────────────────────────────────────

  async $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return db.$transaction(fn);
  },
};
