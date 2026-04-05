// src/app/api/cron/dispute-auto-resolve/route.ts
// ─── Vercel Cron — Dispute Auto-Resolution ─────────────────────────────────
// Runs daily at 3:00 AM UTC (schedule: "0 3 * * *" in vercel.json).
// Finds unresponsive disputes (72h+ without seller response) and re-evaluates.

import { NextRequest, NextResponse } from "next/server";
import { processDisputeAutoResolution } from "@/server/jobs/disputeAutoResolve";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { recordCronRun } from "@/server/lib/cronLogger";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  try {
    const result = await processDisputeAutoResolution();

    await recordCronRun("dispute-auto-resolve", "success", startedAt);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      disputeAutoResolve: result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("cron.dispute_auto_resolve.failed", { error: msg });
    await recordCronRun("dispute-auto-resolve", "error", startedAt, msg);
    return NextResponse.json(
      { success: false, error: "Job failed" },
      { status: 500 },
    );
  }
}
