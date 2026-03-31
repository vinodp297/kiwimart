// src/server/jobs/dispatchReminders.ts
// ─── Dispatch Reminder Job ─────────────────────────────────────────────────
// Sends escalating reminders to sellers who haven't dispatched their orders.
// Called by the auto-release cron (daily at 2:00 AM UTC).
//
// 24h: Gentle nudge
// 48h: Firm reminder
// 72h: Urgent warning

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { notifySellerDispatchReminder } from "@/lib/smartNotifications";

export async function sendDispatchReminders(): Promise<{
  sent: number;
  errors: number;
}> {
  let sent = 0;
  let errors = 0;

  // Find PAYMENT_HELD orders older than 24 hours where seller hasn't dispatched
  const undispatchedOrders = await db.order.findMany({
    where: {
      status: "PAYMENT_HELD",
      createdAt: {
        lte: new Date(Date.now() - 24 * 60 * 60 * 1000), // At least 24h old
      },
    },
    take: 200,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sellerId: true,
      createdAt: true,
      listing: { select: { title: true } },
      buyer: { select: { displayName: true } },
    },
  });

  for (const order of undispatchedOrders) {
    try {
      const hoursSincePayment = Math.floor(
        (Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60),
      );

      // Only send at 24h, 48h, and 72h marks (with 12h tolerance window)
      const shouldSend =
        (hoursSincePayment >= 24 && hoursSincePayment < 36) ||
        (hoursSincePayment >= 48 && hoursSincePayment < 60) ||
        (hoursSincePayment >= 72 && hoursSincePayment < 84);

      if (!shouldSend) continue;

      // Check if we already sent a reminder in this window
      const recentReminder = await db.notification.findFirst({
        where: {
          userId: order.sellerId,
          orderId: order.id,
          type: "SYSTEM",
          createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
          title: { contains: order.listing.title },
        },
      });

      if (recentReminder) continue;

      notifySellerDispatchReminder(
        order.sellerId,
        order.id,
        order.buyer.displayName,
        order.listing.title,
        hoursSincePayment,
      );
      sent++;
    } catch (err) {
      errors++;
      logger.error("dispatch_reminder.failed", {
        orderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("dispatch_reminders.completed", { sent, errors });
  return { sent, errors };
}
