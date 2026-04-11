// src/server/jobs/stripeReconciliation.ts
// ─── Stripe / DB Reconciliation Job ──────────────────────────────────────────
// Detects and auto-fixes discrepancies between Stripe PaymentIntent states and
// DB order statuses. Run hourly via /api/cron/stripe-reconciliation.
//
// Check 1: AWAITING_PAYMENT orders >1 hour old with a Stripe PI
//   Stripe: requires_capture or succeeded → transition to PAYMENT_HELD (webhook missed)
//   Stripe: canceled                      → transition to CANCELLED, release listing
//
// Check 2: PAYMENT_HELD orders >7 days old — log for manual review
//   These may have had funds refunded outside the system or PI expired.

import { stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";
import { orderRepository } from "@/modules/orders/order.repository";
import { transitionOrder } from "@/modules/orders/order.transitions";

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
        const now = Date.now();
        const oneHourAgo = new Date(now - AWAITING_PAYMENT_THRESHOLD_MS);
        const sevenDaysAgo = new Date(now - PAYMENT_HELD_THRESHOLD_MS);

        logger.info("stripe.reconciliation.started", {
          awaitingCutoff: oneHourAgo.toISOString(),
          heldCutoff: sevenDaysAgo.toISOString(),
        });

        let fixed = 0;
        let flagged = 0;

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
                fixed++;
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
                fixed++;
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
            }
          }
        } catch (err) {
          logger.error("stripe.reconciliation.check1_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // ── Check 2: PAYMENT_HELD orders >7 days old ─────────────────────────
        // These are stale escrow holds. Flag for manual review — do not auto-fix
        // as they may involve complex fund movements outside the system.
        try {
          const heldOrders =
            await orderRepository.findPaymentHeldWithPiOlderThan(
              sevenDaysAgo,
              BATCH_SIZE,
            );

          for (const order of heldOrders) {
            logger.error("stripe.reconciliation.stale_payment_held", {
              orderId: order.id,
              stripePaymentIntentId: order.stripePaymentIntentId,
              requiresManualReview: true,
              message:
                "Order has been in PAYMENT_HELD for >7 days — manual review required.",
            });
            flagged++;
          }
        } catch (err) {
          logger.error("stripe.reconciliation.check2_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        logger.info("stripe.reconciliation.completed", { fixed, flagged });
      },
    );
  } finally {
    await releaseLock(LOCK_KEY, lock);
  }
}
