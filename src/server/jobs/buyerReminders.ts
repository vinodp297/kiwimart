// src/server/jobs/buyerReminders.ts
// ─── Buyer Delivery Reminder Emails ──────────────────────────────────────────
// Day 2: gentle nudge — please confirm delivery
// Day 3: urgent — funds auto-release tomorrow

import db from '@/lib/db';
import {
  sendDeliveryReminderEmail,
  sendFinalDeliveryReminderEmail,
} from '@/server/email';

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

  console.log(`[REMINDERS] Day-2: ${day2Orders.length}, Day-3: ${day3Orders.length}`);

  for (const order of day2Orders) {
    try {
      await sendDeliveryReminderEmail({
        to: order.buyer.email,
        buyerName: order.buyer.displayName,
        listingTitle: order.listing.title,
        trackingNumber: order.trackingNumber ?? undefined,
        orderId: order.id,
        daysRemaining: 2,
        confirmUrl: `${appUrl}/dashboard/buyer`,
      });
    } catch (err) {
      console.error(`[REMINDERS] Day-2 failed for order ${order.id}:`, err);
    }
  }

  for (const order of day3Orders) {
    try {
      await sendFinalDeliveryReminderEmail({
        to: order.buyer.email,
        buyerName: order.buyer.displayName,
        listingTitle: order.listing.title,
        trackingNumber: order.trackingNumber ?? undefined,
        orderId: order.id,
        daysRemaining: 1,
        confirmUrl: `${appUrl}/dashboard/buyer`,
      });
    } catch (err) {
      console.error(`[REMINDERS] Day-3 failed for order ${order.id}:`, err);
    }
  }
}
