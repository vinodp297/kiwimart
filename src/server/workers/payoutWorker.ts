// src/server/workers/payoutWorker.ts
// ─── Payout Processing Worker ────────────────────────────────────────────────
// Runs as a persistent background service on Render.com — started via
// src/server/workers/index.ts. See docs/RUNBOOK.md → "Worker Deployment".
//
// Processes payoutQueue jobs:
//   After order.completedAt + 3 business days:
//     1. Acquire distributed lock (prevents duplicate transfer on concurrent retry)
//     2. Calculate fee breakdown using seller's performance tier
//     3. Initiate Stripe transfer with idempotency key (transfer-${payout.id})
//     4. Update payout record with fee breakdown + PROCESSING status
//     5. Send seller notification email
//
// Idempotency guarantee:
//   • Stripe transfer idempotencyKey = "transfer-${payout.id}"
//   • If the transfer succeeds but DB update fails, BullMQ retries the job.
//   • On retry, Stripe returns the SAME transfer — no duplicate payout.
//   • Distributed lock (orderId key) prevents two workers running concurrently.
//
// All jobs check payout.status before proceeding — PENDING only.

import { Worker } from "bullmq";
import { getQueueConnection } from "@/lib/queue";
import type { PayoutJobData } from "@/lib/queue";
import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
import { stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";
import { sendPayoutInitiatedEmail } from "@/server/email";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";
import { calculateFees } from "@/modules/payments/fee-calculator";
import type { PerformanceTier } from "@/lib/seller-tiers";

const VALID_PERFORMANCE_TIERS = new Set<string>(["GOLD", "SILVER", "BRONZE"]);

export function startPayoutWorker() {
  if (process.env.VERCEL) {
    console.error(
      "worker.payout: workers must run on Render.com, not Vercel. See docs/RUNBOOK.md.",
    );
    return;
  }
  const worker = new Worker<PayoutJobData>(
    "payout",
    async (job) => {
      const {
        orderId,
        sellerId,
        stripeAccountId,
        correlationId: jobCorrelationId,
      } = job.data;
      const correlationId = jobCorrelationId ?? `job:${job.id ?? "unknown"}`;

      return runWithRequestContext({ correlationId }, async () => {
        // ── Distributed lock ─────────────────────────────────────────────────
        // Lock key is orderId — prevents two concurrent workers processing the
        // same order simultaneously. Lock timeout is 120 s to accommodate slow
        // Stripe API calls.
        // IMPORTANT: throw (not return) on lock miss so BullMQ marks the job
        // as FAILED and retries it. A normal return marks the job COMPLETE —
        // the seller would never be paid with no error logged and no retry.
        const lockKey = `payout:${orderId}`;
        const lock = await acquireLock(lockKey, 120);
        if (!lock) {
          logger.warn("payout.worker.lock_not_acquired", {
            orderId,
            reason:
              "Lock held by another worker or Redis unavailable — will retry",
          });
          throw new Error("Payout lock not acquired — will retry");
        }

        try {
          // ── Idempotency check ─────────────────────────────────────────────
          // Skip if already processing or paid — handles duplicate job delivery
          // and manual retriggers.
          const payout = await db.payout.findUnique({
            where: { orderId },
            select: { id: true, status: true, amountNzd: true },
          });

          if (!payout) {
            throw new Error(`Payout not found for order ${orderId}`);
          }

          if (payout.status !== "PENDING") {
            logger.info("payout.worker.skipped", {
              payoutId: payout.id,
              status: payout.status,
            });
            return { skipped: true, reason: `Already ${payout.status}` };
          }

          // ── Seller tier lookup ────────────────────────────────────────────
          // Performance tier drives the platform fee rate:
          //   GOLD → 2.5%,  SILVER → 3.0%,  STANDARD/null → 3.5%
          // sellerTierOverride is admin-set; null means no override (use earned tier).
          // For payout purposes we use the stored override as a conservative proxy
          // — full recalculation via trust-score service is not needed here.
          const sellerUser = await db.user.findUnique({
            where: { id: sellerId },
            select: {
              sellerTierOverride: true,
              email: true,
              displayName: true,
            },
          });

          const sellerTier = (
            sellerUser?.sellerTierOverride &&
            VALID_PERFORMANCE_TIERS.has(sellerUser.sellerTierOverride)
              ? sellerUser.sellerTierOverride
              : null
          ) as PerformanceTier;

          // ── Fee calculation ───────────────────────────────────────────────
          // payout.amountNzd is the gross order amount stored by the webhook.
          // calculateFees() returns the seller's net payout after Stripe fee
          // and platform fee (both deducted from seller's side).
          const fees = await calculateFees(payout.amountNzd, sellerTier);

          logger.info("payout.worker.fees_calculated", {
            payoutId: payout.id,
            orderId,
            grossAmountCents: fees.grossAmountCents,
            stripeFee: fees.stripeFee,
            platformFee: fees.platformFee,
            sellerPayout: fees.sellerPayout,
            tier: fees.tier,
          });

          // ── Manual review guard ───────────────────────────────────────────
          // If fees would exceed the seller's payout, flag for manual review
          // and abort — never attempt a Stripe transfer with a sub-minimum amount.
          if (fees.requiresManualReview) {
            logger.error("payout.worker.requires_manual_review", {
              payoutId: payout.id,
              orderId,
              reason: fees.manualReviewReason,
              grossAmountCents: fees.grossAmountCents,
              platformFee: fees.platformFee,
              stripeFee: fees.stripeFee,
            });
            await db.payout.update({
              where: { orderId },
              data: { status: "MANUAL_REVIEW" },
            });
            return { requiresManualReview: true };
          }

          // ── Stripe transfer ───────────────────────────────────────────────
          // idempotencyKey = "transfer-${payout.id}" — payout.id is stable
          // across retries (unlike orderId which could theoretically have
          // multiple payouts). If this job retries after a Stripe success but
          // DB failure, Stripe returns the SAME transfer object — no duplicate
          // payout is created.
          const transfer = await stripe.transfers.create(
            {
              amount: fees.sellerPayout,
              currency: "nzd",
              destination: stripeAccountId,
              metadata: {
                orderId,
                payoutId: payout.id,
                sellerId,
              },
              description: `Buyzi payout for order ${orderId}`,
            },
            { idempotencyKey: `transfer-${payout.id}` },
          );

          // ── DB update ─────────────────────────────────────────────────────
          // Store fee breakdown for financial reconciliation.
          // amountNzd remains the gross amount — platformFeeNzd + stripeFeeNzd
          // show what was deducted. sellerPayout = amountNzd - both fees.
          await db.payout.update({
            where: { orderId },
            data: {
              status: "PROCESSING",
              stripeTransferId: transfer.id,
              platformFeeNzd: fees.platformFee,
              stripeFeeNzd: fees.stripeFee,
              initiatedAt: new Date(),
            },
          });

          // ── Seller notification ───────────────────────────────────────────
          if (sellerUser) {
            const orderForEmail = await db.order.findUnique({
              where: { id: orderId },
              select: { listing: { select: { title: true } } },
            });
            await sendPayoutInitiatedEmail({
              to: sellerUser.email,
              sellerName: sellerUser.displayName ?? "there",
              amountNzd: fees.sellerPayout,
              listingTitle: orderForEmail?.listing?.title ?? "your item",
              orderId,
              estimatedArrival: "2–3 business days",
            });
          }

          // ── Audit ─────────────────────────────────────────────────────────
          audit({
            userId: sellerId,
            action: "PAYOUT_INITIATED",
            entityType: "Payout",
            entityId: payout.id,
            metadata: {
              orderId,
              grossAmountNzd: fees.grossAmountCents,
              sellerPayoutNzd: fees.sellerPayout,
              platformFeeNzd: fees.platformFee,
              stripeFeeNzd: fees.stripeFee,
              tier: fees.tier,
              stripeTransferId: transfer.id,
            },
          });

          return { transferId: transfer.id };
        } finally {
          await releaseLock(lockKey, lock);
        }
      }); // end runWithRequestContext
    },
    {
      connection:
        getQueueConnection() as unknown as import("bullmq").ConnectionOptions,
      concurrency: 2,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error("payout.worker.job_failed", {
      jobId: job?.id,
      orderId: job?.data?.orderId,
      error: err.message,
    });
    audit({
      action: "ADMIN_ACTION",
      metadata: {
        worker: "payout",
        jobId: job?.id,
        orderId: job?.data?.orderId,
        error: err.message,
        status: "failed",
      },
    });
  });

  worker.on("completed", (job) => {
    logger.info("payout.worker.job_completed", {
      jobId: job.id,
      orderId: job.data.orderId,
    });
  });

  return worker;
}
