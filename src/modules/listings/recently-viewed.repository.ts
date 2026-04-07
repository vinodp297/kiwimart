// src/modules/listings/recently-viewed.repository.ts
// ─── Recently Viewed Repository — data access for recently viewed listings ────

import db from "@/lib/db";
import { Prisma } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

export const recentlyViewedRepository = {
  /** Upsert a listing view for the authenticated user.
   * @source src/server/actions/recentlyViewed.ts — recordListingView */
  async upsertView(
    userId: string,
    listingId: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = tx ?? db;
    await client.recentlyViewed.upsert({
      where: { userId_listingId: { userId, listingId } },
      update: { viewedAt: new Date() },
      create: { userId, listingId },
    });
  },

  /** Find the oldest view IDs beyond the cap (for trimming).
   * @source src/server/actions/recentlyViewed.ts — recordListingView */
  async findOlderThanCap(userId: string, cap: number, tx?: DbClient) {
    const client = tx ?? db;
    return client.recentlyViewed.findMany({
      where: { userId },
      orderBy: { viewedAt: "desc" },
      skip: cap,
      select: { id: true },
    });
  },

  /** Delete recently viewed records by id.
   * @source src/server/actions/recentlyViewed.ts — recordListingView */
  async deleteManyByIds(ids: string[], tx?: DbClient): Promise<void> {
    const client = tx ?? db;
    await client.recentlyViewed.deleteMany({ where: { id: { in: ids } } });
  },

  /** Fetch a user's recently viewed listings (newest first).
   * @source src/server/actions/recentlyViewed.ts — getRecentlyViewedFromDB */
  async findByUser(userId: string, limit: number, tx?: DbClient) {
    const client = tx ?? db;
    return client.recentlyViewed.findMany({
      where: { userId },
      orderBy: { viewedAt: "desc" },
      take: limit,
      select: {
        viewedAt: true,
        listing: {
          select: {
            id: true,
            title: true,
            priceNzd: true,
            condition: true,
            status: true,
            deletedAt: true,
            images: {
              where: { order: 0, isSafe: true },
              select: { r2Key: true, thumbnailKey: true },
              take: 1,
            },
          },
        },
      },
    });
  },
};
