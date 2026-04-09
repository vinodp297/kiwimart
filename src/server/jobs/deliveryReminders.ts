// src/server/jobs/deliveryReminders.ts
// ─── Delivery Reminder & Auto-Complete Job ─────────────────────────────────
// Handles two time-based triggers for dispatched orders:
//
// 1. Delivery reminder: When estimatedDeliveryDate + 3 days has passed without
//    buyer confirmation, send a reminder notification.
//
// 2. Auto-complete: If buyer doesn't respond within 7 more days after the
//    reminder (estimatedDeliveryDate + 10 days total), auto-complete the order.
//
// Called daily at 4:00 AM UTC by Vercel Cron via /api/cron/delivery-reminders
// (schedule: "0 4 * * *" in vercel.json).

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { paymentService } from "@/modules/payments/payment.service";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { createNotification } from "@/modules/notifications/notification.service";
import { fireAndForget } from "@/lib/fire-and-forget";
import { notifyBuyerDeliveryOverdue } from "@/lib/smartNotifications";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { audit } from "@/server/lib/audit";

export async function processDeliveryReminders(): Promise<{
  remindersSent: number;
  autoCompleted: number;
  errors: number;
}> {
  return runWithRequestContext(
    { correlationId: `cron:processDeliveryReminders:${Date.now()}` },
    async () => {
      let remindersSent = 0;
      let autoCompleted = 0;
      let errors = 0;

      const now = new Date();

      // Find all DISPATCHED orders that have an estimatedDeliveryDate in their
      // DISPATCHED event metadata
      const dispatchedOrders = await db.order.findMany({
        where: {
          status: "DISPATCHED",
          dispatchedAt: { not: null },
        },
        take: 500,
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          totalNzd: true,
          stripePaymentIntentId: true,
          dispatchedAt: true,
          listing: { select: { title: true, id: true } },
          buyer: { select: { email: true, displayName: true } },
        },
      });

      // ── Bulk-fetch all order events for these orders (eliminates N+1) ──
      const orderIds = dispatchedOrders.map((o) => o.id);
      const allEvents = await db.orderEvent.findMany({
        where: {
          orderId: { in: orderIds },
          type: { in: ["DISPATCHED", "DELIVERY_REMINDER_SENT"] },
        },
        select: { id: true, orderId: true, type: true, metadata: true },
      });

      // Build lookup: orderId → events grouped by type
      const eventsByOrder = new Map<
        string,
        {
          dispatched: (typeof allEvents)[number][];
          reminders: (typeof allEvents)[number][];
        }
      >();
      for (const e of allEvents) {
        if (!eventsByOrder.has(e.orderId)) {
          eventsByOrder.set(e.orderId, { dispatched: [], reminders: [] });
        }
        const bucket = eventsByOrder.get(e.orderId)!;
        if (e.type === "DISPATCHED") bucket.dispatched.push(e);
        else bucket.reminders.push(e);
      }

      for (const order of dispatchedOrders) {
        try {
          const events = eventsByOrder.get(order.id);

          // Get the DISPATCHED event to check estimatedDeliveryDate
          const dispatchEvent = events?.dispatched[0];
          const meta = (dispatchEvent?.metadata ?? {}) as Record<
            string,
            unknown
          >;
          const estDateStr = meta.estimatedDeliveryDate as string | undefined;

          if (!estDateStr) continue; // Legacy order without estimated date

          const estimatedDelivery = new Date(estDateStr);
          if (isNaN(estimatedDelivery.getTime())) continue;

          const daysPastEstimate = Math.floor(
            (now.getTime() - estimatedDelivery.getTime()) /
              (1000 * 60 * 60 * 24),
          );

          // Check if reminder was already sent (from bulk-fetched data)
          const reminderCount = events?.reminders.length ?? 0;
          const reminderSent = reminderCount > 0;

          // 1. Send reminder if 3+ days past estimated delivery and no reminder sent
          if (daysPastEstimate >= 3 && !reminderSent) {
            notifyBuyerDeliveryOverdue(
              order.buyerId,
              order.id,
              order.listing.title,
              daysPastEstimate,
            );

            orderEventService.recordEvent({
              orderId: order.id,
              type: ORDER_EVENT_TYPES.DELIVERY_REMINDER_SENT,
              actorId: null,
              actorRole: ACTOR_ROLES.SYSTEM,
              summary: `Auto-reminder sent: ${daysPastEstimate} days past estimated delivery`,
              metadata: {
                estimatedDeliveryDate: estDateStr,
                daysPastEstimate,
              },
            });

            remindersSent++;
            continue;
          }

          // Also send a second reminder at 10 days
          if (daysPastEstimate >= 10 && daysPastEstimate < 14 && reminderSent) {
            if (reminderCount < 2) {
              notifyBuyerDeliveryOverdue(
                order.buyerId,
                order.id,
                order.listing.title,
                daysPastEstimate,
              );
              orderEventService.recordEvent({
                orderId: order.id,
                type: ORDER_EVENT_TYPES.DELIVERY_REMINDER_SENT,
                actorId: null,
                actorRole: ACTOR_ROLES.SYSTEM,
                summary: `Second reminder sent: ${daysPastEstimate} days past estimated delivery`,
                metadata: {
                  estimatedDeliveryDate: estDateStr,
                  daysPastEstimate,
                },
              });
              remindersSent++;
              continue;
            }
          }

          // 2. Auto-complete if 14+ days past estimated delivery
          //    (3 days grace + 11 days after first reminder)
          if (daysPastEstimate >= 14 && reminderSent) {
            // Capture payment
            if (order.stripePaymentIntentId) {
              try {
                await paymentService.capturePayment({
                  paymentIntentId: order.stripePaymentIntentId,
                  orderId: order.id,
                });
              } catch (err) {
                logger.error("delivery_reminder.capture_failed", {
                  orderId: order.id,
                  error: err instanceof Error ? err.message : String(err),
                });
                errors++;
                continue;
              }
            }

            try {
              await db.$transaction(async (tx) => {
                await transitionOrder(
                  order.id,
                  "COMPLETED",
                  { completedAt: new Date() },
                  { tx, fromStatus: "DISPATCHED" },
                );
                await tx.payout.updateMany({
                  where: { orderId: order.id },
                  data: { status: "PROCESSING", initiatedAt: new Date() },
                });
                await tx.listing.update({
                  where: { id: order.listing.id },
                  data: { status: "SOLD", soldAt: new Date() },
                });
              });
            } catch (err) {
              if ((err as { code?: string }).code === "P2025") {
                // Already transitioned
                continue;
              }
              throw err;
            }

            orderEventService.recordEvent({
              orderId: order.id,
              type: ORDER_EVENT_TYPES.AUTO_COMPLETED,
              actorId: null,
              actorRole: ACTOR_ROLES.SYSTEM,
              summary: `Auto-completed: Buyer did not respond ${daysPastEstimate} days after estimated delivery`,
              metadata: {
                trigger: "DELIVERY_REMINDER_EXPIRED",
                estimatedDeliveryDate: estDateStr,
                daysPastEstimate,
              },
            });

            fireAndForget(
              createNotification({
                userId: order.buyerId,
                type: "ORDER_COMPLETED",
                title: "Order auto-completed",
                body: `Your order "${order.listing.title}" has been auto-completed. Payment has been released to the seller.`,
                orderId: order.id,
                link: `/orders/${order.id}`,
              }),
              "delivery.notification.auto_complete.buyer",
              { orderId: order.id },
            );

            fireAndForget(
              createNotification({
                userId: order.sellerId,
                type: "ORDER_COMPLETED",
                title: "Payment released",
                body: `Order for "${order.listing.title}" auto-completed after delivery reminder period. Payment is being processed.`,
                orderId: order.id,
                link: `/orders/${order.id}`,
              }),
              "delivery.notification.auto_complete.seller",
              { orderId: order.id },
            );

            audit({
              userId: null,
              action: "ORDER_STATUS_CHANGED",
              entityType: "Order",
              entityId: order.id,
              metadata: {
                trigger: "DELIVERY_REMINDER_AUTO_COMPLETE",
                daysPastEstimate,
              },
            });

            autoCompleted++;
          }
        } catch (err) {
          errors++;
          logger.error("delivery_reminder.order_failed", {
            orderId: order.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info("delivery_reminders.completed", {
        remindersSent,
        autoCompleted,
        errors,
      });

      return { remindersSent, autoCompleted, errors };
    }, // end runWithRequestContext fn
  ); // end runWithRequestContext
}
