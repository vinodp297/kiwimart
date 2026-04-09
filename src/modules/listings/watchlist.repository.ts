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
};
