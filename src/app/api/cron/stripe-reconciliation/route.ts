// src/app/api/cron/stripe-reconciliation/route.ts
// ─── Vercel Cron — Stripe / DB Reconciliation ────────────────────────────────
// Runs daily at 2:00 AM NZST (14:00 UTC) via vercel.json schedule "0 14 * * *".
// Detects Stripe ↔ DB discrepancies and logs them for manual review.

import { NextRequest, NextResponse } from "next/server";
import { runStripeReconciliation } from "@/server/jobs/stripeReconciliation";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { recordCronRun } from "@/server/lib/cronLogger";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  try {
    await runStripeReconciliation();
    await recordCronRun("stripe-reconciliation", "success", startedAt);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("cron.stripe_reconciliation.failed", { error: msg });
    await recordCronRun("stripe-reconciliation", "error", startedAt, msg);
    return NextResponse.json(
      { success: false, error: "Job failed" },
      { status: 500 },
    );
  }
}
