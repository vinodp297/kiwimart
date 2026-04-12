// src/server/jobs/stripeReconciliation.ts
// ─── Stripe / DB Reconciliation Job ──────────────────────────────────────────
// Detects and auto-fixes discrepancies between Stripe PaymentIntent states and
// DB order statuses. Run hourly via /api/cron/stripe-reconciliation.
//
// Check 1: AWAITING_PAYMENT orders >1 hour old with a Stripe PI
//   Stripe: requires_capture or succeeded → transition to PAYMENT_HELD (webhook missed)
//   Stripe: canceled                      → transition to CANCELLED, release listing
//
// Check 3 (runs before check 2): PAYMENT_HELD orders >1 hour old where Stripe
//   returns a 404 for the PI (PI was deleted) → auto-cancel + notify buyer/seller
//
// Check 2: PAYMENT_HELD orders >7 days old where PI still exists — alert only
//   These may involve legitimate slow sellers; do not auto-fix.

import { stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";
import { orderRepository } from "@/modules/orders/order.repository";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { createNotification } from "@/modules/notifications/notification.service";
import { fireAndForget } from "@/lib/fire-and-forget";

const LOCK_KEY = "cron:stripe-reconciliation";
const LOCK_TTL_SECONDS = 3600; // 1 hour — matches the cron interval
const BATCH_SIZE = 100;
const AWAITING_PAYMENT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const PAYMENT_HELD_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function runStripeReconciliation(): Promise<void> {
  const lock = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!lock) {
    logger.info("stripe_reconciliation.skipped_lock_held", {
      reason:
        "Another instance is already running — skipping to prevent duplicate processing.",
    });
    return undefined;
  }

  try {
    return await runWithRequestContext(
      { correlationId: `cron:runStripeReconciliation:${Date.now()}` },
      async () => {
        const startTime = Date.now();
        const now = startTime;
        const oneHourAgo = new Date(now - AWAITING_PAYMENT_THRESHOLD_MS);
        const sevenDaysAgo = new Date(now - PAYMENT_HELD_THRESHOLD_MS);

        logger.info("stripe.reconciliation.started", {
          awaitingCutoff: oneHourAgo.toISOString(),
          heldCutoff: sevenDaysAgo.toISOString(),
        });

        let autoFixed = 0;
        let alerted = 0;
        let errors = 0;
        // Collect IDs cancelled in Check 3 so Check 2 (7-day alert) can skip them.
        // Prevents spurious stale-hold alerts for orders we just auto-cancelled.
        const cancelledInCheck3 = new Set<string>();

        // ── Check 1: AWAITING_PAYMENT orders >1 hour old ─────────────────────
        // Retrieve the Stripe PI for each stale order and auto-fix discrepancies.
        try {
          const awaitingOrders =
            await orderRepository.findAwaitingPaymentWithPiOlderThan(
              oneHourAgo,
              BATCH_SIZE,
            );

          for (const order of awaitingOrders) {
            try {
              const pi = await stripe.paymentIntents.retrieve(
                order.stripePaymentIntentId!,
              );

              if (
                pi.status === "requires_capture" ||
                pi.status === "succeeded"
              ) {
                // Payment authorised — webhook missed. Transition to PAYMENT_HELD.
                await transitionOrder(
                  order.id,
                  "PAYMENT_HELD",
                  {},
                  { fromStatus: "AWAITING_PAYMENT" },
                );
                logger.info(
                  "stripe.reconciliation.fixed_awaiting_to_payment_held",
                  {
                    orderId: order.id,
                    piStatus: pi.status,
                    fix: "AWAITING_PAYMENT → PAYMENT_HELD",
                  },
                );
                autoFixed++;
              } else if (pi.status === "canceled") {
                // PI explicitly cancelled — cancel order and release listing.
                await transitionOrder(
                  order.id,
                  "CANCELLED",
                  { cancelledAt: new Date() },
                  { fromStatus: "AWAITING_PAYMENT" },
                );
                await orderRepository.releaseListing(order.listingId);
                logger.info(
                  "stripe.reconciliation.fixed_awaiting_to_cancelled",
                  {
                    orderId: order.id,
                    piStatus: pi.status,
                    fix: "AWAITING_PAYMENT → CANCELLED + listing released",
                  },
                );
                autoFixed++;
              } else {
                // Other statuses (requires_payment_method, processing, etc.) —
                // payment still in flight or failed, log for awareness.
                logger.warn(
                  "stripe.reconciliation.awaiting_unexpected_pi_status",
                  {
                    orderId: order.id,
                    piStatus: pi.status,
                  },
                );
              }
            } catch (err) {
              // P2025 = optimistic lock lost (another process won) — safe to skip.
              if ((err as { code?: string })?.code === "P2025") continue;
              logger.warn("stripe.reconciliation.order_fix_failed", {
                orderId: order.id,
                error: err instanceof Error ? err.message : String(err),
              });
              errors++;
            }
          }
        } catch (err) {
          logger.error("stripe.reconciliation.check1_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          errors++;
        }

        // ── Check 3: PAYMENT_HELD orders >1 hour old where PI is missing ──────
        // Stripe deletes PIs after 1–2 years or when manually purged. An order
        // whose PI 404s is never going to settle — cancel it immediately.
        // Runs BEFORE check 2 so that cancelled orders don't appear in the alert.
        try {
          const heldOrders =
            await orderRepository.findPaymentHeldWithPiOlderThan(
              oneHourAgo,
              BATCH_SIZE,
            );

          for (const order of heldOrders) {
            try {
              await stripe.paymentIntents.retrieve(
                order.stripePaymentIntentId!,
              );
              // PI still exists — check 2 (alert loop) will handle it if >7 days.
            } catch (piErr) {
              const stripeErr = piErr as { statusCode?: number; code?: string };
              const isNotFound =
                stripeErr.statusCode === 404 ||
                stripeErr.code === "resource_missing";

              if (isNotFound) {
                // PI deleted — auto-cancel order and notify both parties.
                await transitionOrder(
                  order.id,
                  "CANCELLED",
                  { cancelledAt: new Date() },
                  { fromStatus: "PAYMENT_HELD" },
                );
                if (order.listingId) {
                  await orderRepository.releaseListing(order.listingId);
                }
                cancelledInCheck3.add(order.id);
                logger.info(
                  "stripe.reconciliation.fixed_held_to_cancelled_pi_missing",
                  {
                    orderId: order.id,
                    fix: "PAYMENT_HELD → CANCELLED (PI not found on Stripe)",
                  },
                );
                fireAndForget(
                  createNotification({
                    userId: order.buyerId,
                    type: "SYSTEM",
                    title: "Order cancelled",
                    body: "Your order was cancelled because the payment record could not be found.",
                    orderId: order.id,
                    link: `/orders/${order.id}`,
                  }),
                  "reconciliation.cancelled_pi_missing.buyer",
                  { orderId: order.id },
                );
                fireAndForget(
                  createNotification({
                    userId: order.sellerId,
                    type: "SYSTEM",
                    title: "Order cancelled",
                    body: "An order was cancelled because the associated payment record could not be found.",
                    orderId: order.id,
                    link: `/orders/${order.id}`,
                  }),
                  "reconciliation.cancelled_pi_missing.seller",
                  { orderId: order.id },
                );
                autoFixed++;
              } else {
                logger.warn("stripe.reconciliation.pi_retrieve_failed", {
                  orderId: order.id,
                  error: piErr instanceof Error ? piErr.message : String(piErr),
                });
                errors++;
              }
            }
          }
        } catch (err) {
          logger.error("stripe.reconciliation.check3_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          errors++;
        }

        // ── Check 2: PAYMENT_HELD orders >7 days old ─────────────────────────
        // These are stale escrow holds where the PI still exists.
        // Alert only — do not auto-fix (may involve legitimate slow sellers).
        try {
          const heldOrders =
            await orderRepository.findPaymentHeldWithPiOlderThan(
              sevenDaysAgo,
              BATCH_SIZE,
            );

          for (const order of heldOrders) {
            // Skip orders already auto-cancelled in Check 3 this run.
            if (cancelledInCheck3.has(order.id)) continue;
            logger.error("stripe.reconciliation.stale_payment_held", {
              orderId: order.id,
              stripePaymentIntentId: order.stripePaymentIntentId,
              requiresManualReview: true,
              message:
                "Order has been in PAYMENT_HELD for >7 days — manual review required.",
            });
            alerted++;
          }
        } catch (err) {
          logger.error("stripe.reconciliation.check2_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          errors++;
        }

        logger.info("stripe.reconciliation.completed", {
          autoFixed,
          alerted,
          errors,
          durationMs: Date.now() - startTime,
        });
      },
    );
  } finally {
    await releaseLock(LOCK_KEY, lock);
  }
}
