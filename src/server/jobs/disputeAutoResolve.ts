// src/server/jobs/disputeAutoResolve.ts
// ─── Dispute Auto-Resolution Job ───────────────────────────────────────────
// Runs periodically to find disputed orders where the seller hasn't responded
// within 72 hours. Re-evaluates each with the auto-resolution engine.
// Called daily at 3:00 AM UTC by Vercel Cron via /api/cron/dispute-auto-resolve
// (schedule: "0 3 * * *" in vercel.json).

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { autoResolutionService } from "@/modules/disputes/auto-resolution.service";

export async function processUnresponsiveDisputes(): Promise<{
  evaluated: number;
  autoResolved: number;
  errors: number;
}> {
  let evaluated = 0;
  let autoResolved = 0;
  let errors = 0;

  const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);

  // Find DISPUTED orders where seller hasn't responded and 72+ hours have passed
  const unresponsiveDisputes = await db.order.findMany({
    where: {
      status: "DISPUTED",
      disputeOpenedAt: { not: null, lte: seventyTwoHoursAgo },
      sellerRespondedAt: null,
      disputeResolvedAt: null,
    },
    take: 100, // Safety cap
    orderBy: { disputeOpenedAt: "asc" },
    select: { id: true, disputeOpenedAt: true },
  });

  logger.info("dispute.auto_resolve.started", {
    count: unresponsiveDisputes.length,
  });

  for (const dispute of unresponsiveDisputes) {
    try {
      const evaluation = await autoResolutionService.evaluateDispute(
        dispute.id,
      );
      evaluated++;

      if (
        evaluation.decision === "AUTO_REFUND" ||
        evaluation.decision === "AUTO_DISMISS"
      ) {
        await autoResolutionService.executeDecision(dispute.id, evaluation);
        autoResolved++;
        logger.info("dispute.auto_resolve.resolved", {
          orderId: dispute.id,
          decision: evaluation.decision,
          score: evaluation.score,
        });
      } else if (evaluation.decision === "FLAG_FRAUD") {
        await autoResolutionService.executeDecision(dispute.id, evaluation);
      }
    } catch (err) {
      errors++;
      logger.error("dispute.auto_resolve.order_failed", {
        orderId: dispute.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("dispute.auto_resolve.completed", {
    evaluated,
    autoResolved,
    errors,
  });

  return { evaluated, autoResolved, errors };
}
