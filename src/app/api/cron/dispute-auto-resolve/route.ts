// src/app/api/cron/dispute-auto-resolve/route.ts
// ─── Vercel Cron — Dispute Auto-Resolution ─────────────────────────────────
// Runs daily at 3:00 AM UTC (schedule: "0 3 * * *" in vercel.json).
// Finds unresponsive disputes (72h+ without seller response) and re-evaluates.

import { NextRequest, NextResponse } from "next/server";
import { processDisputeAutoResolution } from "@/server/jobs/disputeAutoResolve";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { recordCronRun } from "@/server/lib/cronLogger";
import { runCronJob } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  try {
    const result = await runCronJob(
      "processDisputeAutoResolution",
      async () => {
        const r = await processDisputeAutoResolution();
        return {
          processed:
            r.coolingExecuted +
            r.unresponsiveEvaluated +
            r.interactionsEscalated,
          ...r,
        };
      },
    );

    await recordCronRun("dispute-auto-resolve", "success", startedAt);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      disputeAutoResolve: {
        coolingExecuted: result.coolingExecuted,
        unresponsiveEvaluated: result.unresponsiveEvaluated,
        interactionsEscalated: result.interactionsEscalated,
        errors: result.errors,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await recordCronRun("dispute-auto-resolve", "error", startedAt, msg);
    return NextResponse.json(
      { success: false, error: "Job failed" },
      { status: 500 },
    );
  }
}
