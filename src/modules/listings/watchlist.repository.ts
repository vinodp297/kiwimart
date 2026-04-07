// src/modules/listings/watchlist.repository.ts
// ─── Watchlist Repository — data access for watchlist items ──────────────────

import db from "@/lib/db";
import { Prisma } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

export const watchlistRepository = {
  /** Find a watchlist item by user and listing.
   * @source src/server/actions/watchlist.ts — togglePriceAlert */
  async findByUserAndListing(userId: string, listingId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.watchlistItem.findFirst({
      where: { userId, listingId },
      select: { id: true },
    });
  },

  /** Enable or disable price alerts for a watchlist item.
   * @source src/server/actions/watchlist.ts — togglePriceAlert */
  async updatePriceAlert(
    id: string,
    isPriceAlertEnabled: boolean,
    tx?: DbClient,
  ): Promise<void> {
    const client = tx ?? db;
    await client.watchlistItem.update({
      where: { id },
      data: { isPriceAlertEnabled },
    });
  },
};
