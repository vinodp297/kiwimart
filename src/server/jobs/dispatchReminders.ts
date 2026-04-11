// src/server/jobs/dispatchReminders.ts
// ─── Dispatch Reminder Job ─────────────────────────────────────────────────
// Sends escalating reminders to sellers who haven't dispatched their orders.
// Called by the auto-release cron (daily at 2:00 AM UTC).
//
// 24h: Gentle nudge
// 48h: Firm reminder
// 72h: Urgent warning

import { logger } from "@/shared/logger";
import { notifySellerDispatchReminder } from "@/lib/smartNotifications";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";
import { orderRepository } from "@/modules/orders/order.repository";
import { notificationRepository } from "@/modules/notifications/notification.repository";

export async function sendDispatchReminders(): Promise<{
  sent: number;
  errors: number;
}> {
  const LOCK_KEY = "cron:dispatch-reminders";
  const LOCK_TTL_SECONDS = 300;

  const lock = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!lock) {
    logger.info("dispatch_reminders.skipped_lock_held", {
      reason:
        "Another instance is already running — skipping to prevent duplicate processing.",
    });
    return { sent: 0, errors: 0 };
  }

  try {
    return await runWithRequestContext(
      { correlationId: `cron:sendDispatchReminders:${Date.now()}` },
      async () => {
        let sent = 0;
        let errors = 0;

        // Find PAYMENT_HELD orders older than 24 hours where seller hasn't dispatched
        const undispatchedOrders =
          await orderRepository.findUndispatchedOlderThan(
            new Date(Date.now() - 24 * 60 * 60 * 1000),
            200,
          );

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
          const existingReminders =
            await notificationRepository.findRecentSystemForOrders(
              windowOrderIds,
              new Date(Date.now() - 12 * 60 * 60 * 1000),
            );
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
  } finally {
    await releaseLock(LOCK_KEY, lock);
  }
}
