// src/server/jobs/buyerReminders.ts
// ─── Buyer Delivery Reminder Emails ──────────────────────────────────────────
// Day 2: gentle nudge — please confirm delivery
// Day 3: urgent — funds auto-release tomorrow

import {
  sendDeliveryReminderEmail,
  sendFinalDeliveryReminderEmail,
} from "@/server/email";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";
import { orderRepository } from "@/modules/orders/order.repository";

const LOCK_KEY = "cron:buyer-reminders";
const LOCK_TTL_SECONDS = 300;

export async function sendDeliveryReminders(): Promise<void> {
  const lock = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!lock) {
    logger.info("buyer_reminders.skipped_lock_held", {
      reason:
        "Another instance is already running — skipping to prevent duplicate emails.",
    });
    return;
  }

  try {
    return await runWithRequestContext(
      { correlationId: `cron:sendDeliveryReminders:${Date.now()}` },
      async () => {
        const now = new Date();
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

        // Day 2 window: dispatched between 3 and 2 days ago
        const day2Start = new Date(now);
        day2Start.setDate(day2Start.getDate() - 3);
        const day2End = new Date(now);
        day2End.setDate(day2End.getDate() - 2);

        // Day 3 window: dispatched between 4 and 3 days ago
        const day3Start = new Date(now);
        day3Start.setDate(day3Start.getDate() - 4);
        const day3End = new Date(now);
        day3End.setDate(day3End.getDate() - 3);

        const [day2Orders, day3Orders] = await Promise.all([
          orderRepository.findDispatchedInWindow(day2Start, day2End),
          orderRepository.findDispatchedInWindow(day3Start, day3End),
        ]);

        logger.info("reminders.started", {
          day2: day2Orders.length,
          day3: day3Orders.length,
        });

        // Send all reminders in parallel with error isolation
        const day2Results = await Promise.allSettled(
          day2Orders.map((order) =>
            sendDeliveryReminderEmail({
              to: order.buyer.email,
              buyerName: order.buyer.displayName,
              listingTitle: order.listing.title,
              trackingNumber: order.trackingNumber ?? undefined,
              orderId: order.id,
              daysRemaining: 2,
              confirmUrl: `${appUrl}/dashboard/buyer`,
            }),
          ),
        );

        const day3Results = await Promise.allSettled(
          day3Orders.map((order) =>
            sendFinalDeliveryReminderEmail({
              to: order.buyer.email,
              buyerName: order.buyer.displayName,
              listingTitle: order.listing.title,
              trackingNumber: order.trackingNumber ?? undefined,
              orderId: order.id,
              daysRemaining: 1,
              confirmUrl: `${appUrl}/dashboard/buyer`,
            }),
          ),
        );

        // Log failures without blocking
        day2Results.forEach((result, i) => {
          if (result.status === "rejected") {
            logger.error("reminders.day2.failed", {
              orderId: day2Orders[i]?.id,
              error: String(result.reason),
            });
          }
        });
        day3Results.forEach((result, i) => {
          if (result.status === "rejected") {
            logger.error("reminders.day3.failed", {
              orderId: day3Orders[i]?.id,
              error: String(result.reason),
            });
          }
        });

        const day2Succeeded = day2Results.filter(
          (r) => r.status === "fulfilled",
        ).length;
        const day3Succeeded = day3Results.filter(
          (r) => r.status === "fulfilled",
        ).length;
        logger.info("reminders.complete", {
          day2: { total: day2Orders.length, sent: day2Succeeded },
          day3: { total: day3Orders.length, sent: day3Succeeded },
        });
      }, // end runWithRequestContext fn
    ); // end runWithRequestContext
  } finally {
    await releaseLock(LOCK_KEY, lock);
  }
}
