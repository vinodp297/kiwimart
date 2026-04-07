// src/server/jobs/priceDropNotifications.ts
// ─── Price Drop Notification Job ───────────────────────────────────────────
// Scans watchlist items where isPriceAlertEnabled is true and the listing's
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

  // Filter to items where price has actually dropped
  const droppedItems = watchItems.filter(
    (item) => item.listing.priceNzd < item.priceAtWatch!,
  );

  // Fire all notifications in parallel (fire-and-forget)
  droppedItems.forEach((item) => {
    const oldDollars = (item.priceAtWatch! / 100).toFixed(2);
    const newDollars = (item.listing.priceNzd / 100).toFixed(2);
    createNotification({
      userId: item.userId,
      type: "SYSTEM",
      title: `Price drop on "${item.listing.title}"`,
      body: `"${item.listing.title}" dropped from $${oldDollars} to $${newDollars}!`,
      listingId: item.listing.id,
      link: `/listings/${item.listing.id}`,
    }).catch(() => {});
  });

  // Bulk update all priceAtWatch values in one transaction (each item has a different price)
  if (droppedItems.length > 0) {
    await db.$transaction(
      droppedItems.map((item) =>
        db.watchlistItem.update({
          where: { id: item.id },
          data: { priceAtWatch: item.listing.priceNzd },
        }),
      ),
    );
  }

  const notified = droppedItems.length;

  logger.info("price_drop_notifications.completed", {
    checked: watchItems.length,
    notified,
  });

  return { checked: watchItems.length, notified };
}
