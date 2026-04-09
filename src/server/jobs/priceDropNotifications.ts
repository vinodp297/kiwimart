// src/server/jobs/priceDropNotifications.ts
// ─── Price Drop Notification Job ───────────────────────────────────────────
// Scans watchlist items where isPriceAlertEnabled is true and the listing's
// current price has dropped below the watcher's recorded priceAtWatch.
// Creates a notification per watcher and updates priceAtWatch to prevent
// duplicate alerts on the same price drop.

import db from "@/lib/db";
import { formatCentsAsNzd } from "@/lib/currency";
import { createNotification } from "@/modules/notifications/notification.service";
import { fireAndForget } from "@/lib/fire-and-forget";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";

export async function checkPriceDrops(): Promise<{
  checked: number;
  notified: number;
}> {
  const LOCK_KEY = "cron:price-drop-notifications";
  const LOCK_TTL_SECONDS = 300;

  const lock = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!lock) {
    logger.info("price_drop_notifications.skipped_lock_held", {
      reason:
        "Another instance is already running — skipping to prevent duplicate processing.",
    });
    return { checked: 0, notified: 0 };
  }

  try {
    return await runWithRequestContext(
      { correlationId: `cron:checkPriceDrops:${Date.now()}` },
      async () => {
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
          const oldDollars = formatCentsAsNzd(item.priceAtWatch!);
          const newDollars = formatCentsAsNzd(item.listing.priceNzd);
          fireAndForget(
            createNotification({
              userId: item.userId,
              type: "SYSTEM",
              title: `Price drop on "${item.listing.title}"`,
              body: `"${item.listing.title}" dropped from ${oldDollars} to ${newDollars}!`,
              listingId: item.listing.id,
              link: `/listings/${item.listing.id}`,
            }),
            "priceDrop.notification",
            { listingId: item.listing.id, userId: item.userId },
          );
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
      }, // end runWithRequestContext fn
    ); // end runWithRequestContext
  } finally {
    await releaseLock(LOCK_KEY, lock);
  }
}
