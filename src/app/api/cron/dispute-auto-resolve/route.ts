// src/app/api/cron/dispute-auto-resolve/route.ts
// ─── Vercel Cron — Dispute Auto-Resolution ─────────────────────────────────
// Runs daily at 3:00 AM UTC (schedule: "0 3 * * *" in vercel.json).
// Finds unresponsive disputes (72h+ without seller response) and re-evaluates.

import { NextRequest, NextResponse } from "next/server";
import { processUnresponsiveDisputes } from "@/server/jobs/disputeAutoResolve";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  try {
    const result = await processUnresponsiveDisputes();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      disputeAutoResolve: result,
    });
  } catch (error) {
    logger.error("cron.dispute_auto_resolve.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: "Job failed" },
      { status: 500 },
    );
  }
}
