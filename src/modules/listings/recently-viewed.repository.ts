// src/modules/listings/recently-viewed.repository.ts
// ─── Recently Viewed Repository — data access for recently viewed listings ────

import { getClient, type DbClient } from "@/lib/db";

export const recentlyViewedRepository = {
  /** Upsert a listing view for the authenticated user. */
  async upsertView(
    userId: string,
    listingId: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.recentlyViewed.upsert({
      where: { userId_listingId: { userId, listingId } },
      update: { viewedAt: new Date() },
      create: { userId, listingId },
    });
  },

  /** Find the oldest view IDs beyond the cap (for trimming). */
  async findOlderThanCap(userId: string, cap: number, tx?: DbClient) {
    const client = getClient(tx);
    return client.recentlyViewed.findMany({
      where: { userId },
      orderBy: { viewedAt: "desc" },
      skip: cap,
      select: { id: true },
    });
  },

  /** Delete recently viewed records by id. */
  async deleteManyByIds(ids: string[], tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.recentlyViewed.deleteMany({ where: { id: { in: ids } } });
  },

  /** Fetch a user's recently viewed listings (newest first). */
  async findByUser(userId: string, limit: number, tx?: DbClient) {
    const client = getClient(tx);
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
