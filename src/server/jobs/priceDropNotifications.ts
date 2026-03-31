// src/server/jobs/priceDropNotifications.ts
// ─── Price Drop Notification Job ───────────────────────────────────────────
// Scans watchlist items where priceAlertEnabled is true and the listing's
// current price has dropped below the watcher's recorded priceAtWatch.
// Creates a notification per watcher and updates priceAtWatch to prevent
// duplicate alerts on the same price drop.

import db from "@/lib/db";
import { createNotification } from "@/modules/notifications/notification.service";
import { logger } from "@/shared/logger";

export async function checkPriceDrops(): Promise<{
  checked: number;
  notified: number;
}> {
  // Fetch all watchlist items with alerts enabled that have a reference price
  const watchItems = await db.watchlistItem.findMany({
    where: {
      priceAlertEnabled: true,
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

  let notified = 0;

  for (const item of watchItems) {
    const savedPrice = item.priceAtWatch!;
    const currentPrice = item.listing.priceNzd;

    if (currentPrice >= savedPrice) continue;

    // Price dropped — notify watcher
    const oldDollars = (savedPrice / 100).toFixed(2);
    const newDollars = (currentPrice / 100).toFixed(2);

    createNotification({
      userId: item.userId,
      type: "SYSTEM",
      title: `Price drop on "${item.listing.title}"`,
      body: `"${item.listing.title}" dropped from $${oldDollars} to $${newDollars}!`,
      listingId: item.listing.id,
      link: `/listings/${item.listing.id}`,
    }).catch(() => {});

    // Update priceAtWatch to current price so same drop isn't notified twice
    await db.watchlistItem.update({
      where: { id: item.id },
      data: { priceAtWatch: currentPrice },
    });

    notified++;
  }

  logger.info("price_drop_notifications.completed", {
    checked: watchItems.length,
    notified,
  });

  return { checked: watchItems.length, notified };
}
