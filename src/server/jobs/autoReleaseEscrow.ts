// src/server/jobs/autoReleaseEscrow.ts
// Captures Stripe payment and marks order COMPLETED for dispatched orders
// that have not been confirmed by the buyer after 4 BUSINESS days.
// Called daily at 2:00 AM UTC by Vercel Cron via /api/cron/auto-release
// (schedule: "0 2 * * *" in vercel.json).

import db from "@/lib/db";
import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { audit } from "@/server/lib/audit";
import { paymentService } from "@/modules/payments/payment.service";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";
import { logger } from "@/shared/logger";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { runWithRequestContext } from "@/lib/request-context";
import { orderRepository } from "@/modules/orders/order.repository";

// ─── Adaptive batching constants ─────────────────────────────────────────────
const BATCH_SIZE_MIN = 50;
const BATCH_SIZE_MAX = 500;
const BATCH_SIZE_DEFAULT = 100;
const BACKLOG_ALERT_THRESHOLD = 200;

/**
 * Add N business days (Mon–Fri) to a date.
 * E.g. Friday + 4 business days = Thursday of the following week.
 */
export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

export async function processAutoReleases(): Promise<{
  processed: number;
  errors: number;
}> {
  return runWithRequestContext(
    { correlationId: `cron:processAutoReleases:${Date.now()}` },
    async () => {
      let processed = 0;
      let errors = 0;
      const startMs = Date.now();
      const escrowDays = await getConfigInt(
        CONFIG_KEYS.ESCROW_RELEASE_BUSINESS_DAYS,
      );

      // Count the backlog first so we can size the batch fetch adaptively.
      // This avoids over-fetching on quiet nights and caps memory use on busy days.
      const backlogCount = await orderRepository.countEligibleForAutoRelease();

      // Alert ops when the backlog is growing faster than the cron can drain it.
      if (backlogCount > BACKLOG_ALERT_THRESHOLD) {
        import("@sentry/nextjs")
          .then(({ captureMessage }) => {
            captureMessage(
              `autoReleaseEscrow: backlog (${backlogCount}) exceeds alert threshold (${BACKLOG_ALERT_THRESHOLD}). Consider increasing run frequency or batch size.`,
              "warning",
            );
          })
          .catch(() => {});
      }

      // Choose fetch limit: scale with actual backlog, but never below MIN or above MAX.
      // BATCH_SIZE_DEFAULT is used when the backlog is smaller than it so we don't
      // under-fetch on a quiet night where a handful of new orders just became eligible.
      // The BATCH_SIZE_MIN absolute floor ensures we always have a safe lower bound.
      const batchSize = Math.max(
        BATCH_SIZE_MIN,
        Math.min(BATCH_SIZE_MAX, Math.max(BATCH_SIZE_DEFAULT, backlogCount)),
      );

      logger.info("escrow.auto_release.batch_sizing", {
        backlogCount,
        batchSize,
        alertThreshold: BACKLOG_ALERT_THRESHOLD,
      });

      // DB-side pre-filter: only orders dispatched within the last 30 days.
      // The JS addBusinessDays() filter below fine-tunes the exact 4-business-day cutoff.
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      const dispatchedOrders = await db.order.findMany({
        where: {
          status: "DISPATCHED",
          dispatchedAt: {
            not: null,
            gte: cutoffDate,
          },
        },
        take: batchSize,
        orderBy: { dispatchedAt: "asc" }, // Process oldest first
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          totalNzd: true,
          stripePaymentIntentId: true,
          dispatchedAt: true,
          listing: { select: { title: true, id: true } },
          buyer: { select: { email: true, displayName: true } },
          seller: { select: { email: true, displayName: true } },
        },
      });

      const now = new Date();
      const eligibleOrders = dispatchedOrders.filter((order) => {
        if (!order.dispatchedAt) return false;
        const releaseDate = addBusinessDays(order.dispatchedAt, escrowDays);
        return releaseDate <= now;
      });

      logger.info("escrow.auto_release.started", {
        eligible: eligibleOrders.length,
        dispatched: dispatchedOrders.length,
      });

      // Process in parallel batches of 10 to avoid sequential Stripe calls
      const BATCH_SIZE = 10;

      async function processOrderRelease(
        order: (typeof eligibleOrders)[number],
      ) {
        // Hard fail on missing payment intent
        if (!order.stripePaymentIntentId) {
          logger.error("escrow.auto_release.skipped", {
            orderId: order.id,
            reason: "missing_payment_intent",
            requiresManualReview: true,
          });
          audit({
            userId: null,
            action: "ORDER_STATUS_CHANGED",
            entityType: "Order",
            entityId: order.id,
            metadata: {
              trigger: "AUTO_RELEASE_SKIPPED",
              reason: "missing_payment_intent",
              requiresManualReview: true,
            },
          });
          return false;
        }

        // Distributed lock — prevents two cron runs from double-releasing the same order
        const lockValue = await acquireLock(`order:release:${order.id}`, 60);
        if (lockValue === null) {
          // Lock held by concurrent process — already being processed
          logger.info("escrow.auto_release.lock_skipped", {
            orderId: order.id,
          });
          return true; // Treat as already processed
        }

        // Fail-closed in production: if Redis is unavailable, skip this order
        // and let the next cron run retry once Redis recovers.
        if (
          lockValue === "NO_REDIS_LOCK" &&
          process.env.NODE_ENV === "production"
        ) {
          logger.error("escrow.auto_release.redis_unavailable", {
            orderId: order.id,
            message:
              "Redis unavailable in production — skipping order. Will retry next cron run.",
          });
          return false;
        }

        try {
          // Stripe capture FIRST via PaymentService, then DB update
          try {
            await paymentService.capturePayment({
              paymentIntentId: order.stripePaymentIntentId,
              orderId: order.id,
            });
          } catch (captureErr) {
            logger.error("escrow.auto_release.capture_failed", {
              orderId: order.id,
              error:
                captureErr instanceof Error
                  ? captureErr.message
                  : String(captureErr),
              requiresManualReview: true,
            });
            audit({
              userId: null,
              action: "ORDER_STATUS_CHANGED",
              entityType: "Order",
              entityId: order.id,
              metadata: {
                trigger: "AUTO_RELEASE_CAPTURE_FAILED",
                error:
                  captureErr instanceof Error
                    ? captureErr.message
                    : String(captureErr),
                requiresManualReview: true,
              },
            });
            return false;
          }

          // DB update ONLY AFTER Stripe capture succeeds — callback form for transitionOrder
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
          // P2025 = optimistic lock conflict — another process already transitioned this order
          if ((err as { code?: string }).code === "P2025") {
            logger.info("escrow.auto_release.already_processed", {
              orderId: order.id,
            });
            return true;
          }
          throw err;
        } finally {
          await releaseLock(`order:release:${order.id}`, lockValue);
        }

        audit({
          userId: null,
          action: "ORDER_STATUS_CHANGED",
          entityType: "Order",
          entityId: order.id,
          metadata: {
            newStatus: "COMPLETED",
            previousStatus: "DISPATCHED",
            trigger: "AUTO_RELEASE",
            buyerEmail: order.buyer.email,
            sellerEmail: order.seller.email,
          },
        });

        orderEventService.recordEvent({
          orderId: order.id,
          type: ORDER_EVENT_TYPES.COMPLETED,
          actorId: null,
          actorRole: ACTOR_ROLES.SYSTEM,
          summary:
            "Order auto-completed — buyer did not confirm delivery within 4 business days",
          metadata: { trigger: "AUTO_RELEASE" },
        });

        logger.info("escrow.auto_release.order_released", {
          orderId: order.id,
          sellerName: order.seller.displayName,
        });
        return true;
      }

      for (let i = 0; i < eligibleOrders.length; i += BATCH_SIZE) {
        const batch = eligibleOrders.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(async (order) => {
            try {
              return await processOrderRelease(order);
            } catch (err) {
              logger.error("escrow.auto_release.failed", {
                orderId: order.id,
                error: err instanceof Error ? err.message : String(err),
              });
              return false;
            }
          }),
        );

        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            processed++;
          } else {
            errors++;
          }
        }

        // Small delay between batches to respect Stripe rate limits
        if (i + BATCH_SIZE < eligibleOrders.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // CASH_ON_PICKUP orders are already COMPLETED at this point (the pickup
      // worker transitions them). A Payout record with status PENDING was created
      // at order-creation time. After the same business-day escrow window we mark
      // the payout PAID — no Stripe involvement because cash changed hands IRL.

      const cashCutoff = new Date();
      cashCutoff.setDate(cashCutoff.getDate() - 30);

      const cashOrders = await db.order.findMany({
        where: {
          status: "COMPLETED",
          fulfillmentType: "CASH_ON_PICKUP",
          completedAt: {
            not: null,
            gte: cashCutoff,
          },
          payout: {
            status: "PENDING",
          },
        },
        take: batchSize,
        orderBy: { completedAt: "asc" },
        select: {
          id: true,
          sellerId: true,
          completedAt: true,
          payout: { select: { id: true, status: true } },
        },
      });

      const nowCash = new Date();
      const eligibleCashOrders = cashOrders.filter((order) => {
        if (!order.completedAt) return false;
        const releaseDate = addBusinessDays(order.completedAt, escrowDays);
        return releaseDate <= nowCash;
      });

      logger.info("escrow.cash_release.started", {
        eligible: eligibleCashOrders.length,
        total: cashOrders.length,
      });

      for (let i = 0; i < eligibleCashOrders.length; i += BATCH_SIZE) {
        const batch = eligibleCashOrders.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(async (order) => {
            const lockValue = await acquireLock(
              `order:cash-release:${order.id}`,
              60,
            );
            if (lockValue === null) {
              logger.info("escrow.cash_release.lock_skipped", {
                orderId: order.id,
              });
              return true;
            }
            if (
              lockValue === "NO_REDIS_LOCK" &&
              process.env.NODE_ENV === "production"
            ) {
              logger.error("escrow.cash_release.redis_unavailable", {
                orderId: order.id,
              });
              return false;
            }

            try {
              await db.payout.updateMany({
                where: { orderId: order.id, status: "PENDING" },
                data: { status: "PAID", paidAt: new Date() },
              });

              audit({
                userId: null,
                action: "PAYOUT_INITIATED",
                entityType: "Payout",
                entityId: order.payout?.id ?? order.id,
                metadata: {
                  orderId: order.id,
                  newStatus: "PAID",
                  trigger: "CASH_ESCROW_RELEASE",
                },
              });

              orderEventService.recordEvent({
                orderId: order.id,
                type: ORDER_EVENT_TYPES.COMPLETED,
                actorId: null,
                actorRole: ACTOR_ROLES.SYSTEM,
                summary:
                  "Cash pickup payout finalized — escrow hold period elapsed",
                metadata: { trigger: "CASH_ESCROW_RELEASE" },
              });

              logger.info("escrow.cash_release.payout_finalized", {
                orderId: order.id,
                sellerId: order.sellerId,
              });
              return true;
            } catch (err) {
              logger.error("escrow.cash_release.failed", {
                orderId: order.id,
                error: err instanceof Error ? err.message : String(err),
              });
              return false;
            } finally {
              await releaseLock(`order:cash-release:${order.id}`, lockValue);
            }
          }),
        );

        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            processed++;
          } else {
            errors++;
          }
        }
      }

      const succeeded = processed;
      const failed = errors;
      const durationMs = Date.now() - startMs;
      // Remaining estimate: how many more orders might still be eligible that
      // weren't fetched this run (i.e. backlog exceeded our batch size).
      const remainingEstimate = Math.max(0, backlogCount - batchSize);

      logger.info("escrow.auto_release.completed", {
        processed: succeeded,
        errors: failed,
        backlogCount,
        batchSize,
        remainingEstimate,
        durationMs,
      });
      return { processed, errors };
    }, // end runWithRequestContext fn
  ); // end runWithRequestContext
}

export async function getAutoReleaseCountdown(dispatchedAt: Date): Promise<{
  daysRemaining: number;
  releaseDate: Date;
}> {
  const escrowDays = await getConfigInt(
    CONFIG_KEYS.ESCROW_RELEASE_BUSINESS_DAYS,
  );
  const releaseDate = addBusinessDays(dispatchedAt, escrowDays);
  const now = new Date();
  const msRemaining = releaseDate.getTime() - now.getTime();
  const daysRemaining = Math.max(
    0,
    Math.ceil(msRemaining / (1000 * 60 * 60 * 24)),
  );
  return { daysRemaining, releaseDate };
}
