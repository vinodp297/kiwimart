// src/modules/listings/watchlist.repository.ts
// ─── Watchlist Repository — data access for watchlist items ──────────────────

import { getClient, type DbClient } from "@/lib/db";

export const watchlistRepository = {
  /** Find a watchlist item by user and listing. */
  async findByUserAndListing(userId: string, listingId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.watchlistItem.findFirst({
      where: { userId, listingId },
      select: { id: true },
    });
  },

  /** Enable or disable price alerts for a watchlist item. */
  async updatePriceAlert(
    id: string,
    isPriceAlertEnabled: boolean,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.watchlistItem.update({
      where: { id },
      data: { isPriceAlertEnabled },
    });
  },

  /**
   * Find every active price-alert watchlist item with a recorded reference
   * price — used by the price-drop notification cron.
   */
  async findActivePriceAlerts(tx?: DbClient) {
    const client = getClient(tx);
    return client.watchlistItem.findMany({
      where: {
        isPriceAlertEnabled: true,
        priceAtWatch: { not: null },
        listing: {
          status: "ACTIVE",
          deletedAt: null,
        },
      },
      select: {
        id: true,
        userId: true,
        priceAtWatch: true,
        listing: {
          select: {
            id: true,
            title: true,
            priceNzd: true,
          },
        },
      },
    });
  },

  /** Update the recorded reference price for a watchlist item. */
  async updatePriceAtWatch(
    id: string,
    priceAtWatch: number,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.watchlistItem.update({
      where: { id },
      data: { priceAtWatch },
    });
  },
};
