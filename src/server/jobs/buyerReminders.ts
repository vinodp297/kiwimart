// src/server/jobs/buyerReminders.ts
// ─── Buyer Delivery Reminder Emails ──────────────────────────────────────────
// Day 2: gentle nudge — please confirm delivery
// Day 3: urgent — funds auto-release tomorrow

import db from '@/lib/db';
import {
  sendDeliveryReminderEmail,
  sendFinalDeliveryReminderEmail,
} from '@/server/email';
import { logger } from '@/shared/logger';

export async function sendDeliveryReminders(): Promise<void> {
  const now = new Date();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

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
    db.order.findMany({
      where: {
        status: 'DISPATCHED',
        dispatchedAt: { gte: day2Start, lt: day2End },
      },
      select: {
        id: true,
        listing: { select: { title: true } },
        buyer: { select: { email: true, displayName: true } },
        trackingNumber: true,
      },
    }),
    db.order.findMany({
      where: {
        status: 'DISPATCHED',
        dispatchedAt: { gte: day3Start, lt: day3End },
      },
      select: {
        id: true,
        listing: { select: { title: true } },
        buyer: { select: { email: true, displayName: true } },
        trackingNumber: true,
      },
    }),
  ]);

  logger.info('reminders.started', { day2: day2Orders.length, day3: day3Orders.length });

  // Send all reminders in parallel with error isolation
  const day2Results = await Promise.allSettled(
    day2Orders.map(order =>
      sendDeliveryReminderEmail({
        to: order.buyer.email,
        buyerName: order.buyer.displayName,
        listingTitle: order.listing.title,
        trackingNumber: order.trackingNumber ?? undefined,
        orderId: order.id,
        daysRemaining: 2,
        confirmUrl: `${appUrl}/dashboard/buyer`,
      })
    )
  );

  const day3Results = await Promise.allSettled(
    day3Orders.map(order =>
      sendFinalDeliveryReminderEmail({
        to: order.buyer.email,
        buyerName: order.buyer.displayName,
        listingTitle: order.listing.title,
        trackingNumber: order.trackingNumber ?? undefined,
        orderId: order.id,
        daysRemaining: 1,
        confirmUrl: `${appUrl}/dashboard/buyer`,
      })
    )
  );

  // Log failures without blocking
  day2Results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.error('reminders.day2.failed', { orderId: day2Orders[i].id, error: String(result.reason) });
    }
  });
  day3Results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.error('reminders.day3.failed', { orderId: day3Orders[i].id, error: String(result.reason) });
    }
  });

  const day2Succeeded = day2Results.filter(r => r.status === 'fulfilled').length;
  const day3Succeeded = day3Results.filter(r => r.status === 'fulfilled').length;
  logger.info('reminders.complete', {
    day2: { total: day2Orders.length, sent: day2Succeeded },
    day3: { total: day3Orders.length, sent: day3Succeeded },
  });
}
