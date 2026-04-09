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
import { runWithRequestContext } from "@/lib/request-context";

export async function sendDispatchReminders(): Promise<{
  sent: number;
  errors: number;
}> {
  return runWithRequestContext(
    { correlationId: `cron:sendDispatchReminders:${Date.now()}` },
    async () => {
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

      // Filter to orders in the 24h/48h/72h notification windows (CPU-only, no DB)
      const ordersInWindow = undispatchedOrders
        .map((order) => ({
          order,
          hoursSincePayment: Math.floor(
            (Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60),
          ),
        }))
        .filter(
          ({ hoursSincePayment }) =>
            (hoursSincePayment >= 24 && hoursSincePayment < 36) ||
            (hoursSincePayment >= 48 && hoursSincePayment < 60) ||
            (hoursSincePayment >= 72 && hoursSincePayment < 84),
        );

      if (ordersInWindow.length > 0) {
        // Bulk check for existing reminders — single query replaces N findFirst calls
        const windowOrderIds = ordersInWindow.map(({ order }) => order.id);
        const existingReminders = await db.notification.findMany({
          where: {
            orderId: { in: windowOrderIds },
            type: "SYSTEM",
            createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
          },
          select: { orderId: true },
        });
        const alreadyNotified = new Set(
          existingReminders.map((n) => n.orderId).filter(Boolean),
        );

        const ordersToNotify = ordersInWindow.filter(
          ({ order }) => !alreadyNotified.has(order.id),
        );

        // Send notifications in parallel
        const results = await Promise.all(
          ordersToNotify.map(async ({ order, hoursSincePayment }) => {
            try {
              notifySellerDispatchReminder(
                order.sellerId,
                order.id,
                order.buyer.displayName,
                order.listing.title,
                hoursSincePayment,
              );
              return { success: true as const };
            } catch (err) {
              logger.error("dispatch_reminder.failed", {
                orderId: order.id,
                error: err instanceof Error ? err.message : String(err),
              });
              return { success: false as const };
            }
          }),
        );

        sent += results.filter((r) => r.success).length;
        errors += results.filter((r) => !r.success).length;
      }

      logger.info("dispatch_reminders.completed", { sent, errors });
      return { sent, errors };
    }, // end runWithRequestContext fn
  ); // end runWithRequestContext
}
