// src/app/api/cron/auto-release/route.ts
// ─── Vercel Cron — Auto-Release Escrow ───────────────────────────────────────
// Runs daily at 2:00 AM UTC (schedule: "0 2 * * *" in vercel.json).
// Sends day-2 and day-3 buyer reminders, then releases overdue escrow.

import { NextRequest, NextResponse } from "next/server";
import { processAutoReleases } from "@/server/jobs/autoReleaseEscrow";
import { sendDeliveryReminders } from "@/server/jobs/buyerReminders";
import { sendDispatchReminders } from "@/server/jobs/dispatchReminders";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { recordCronRun } from "@/server/lib/cronLogger";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  try {
    await sendDeliveryReminders();
    const dispatchResult = await sendDispatchReminders();
    const result = await processAutoReleases();

    await recordCronRun("auto-release", "success", startedAt);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      autoReleases: result,
      dispatchReminders: dispatchResult,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("cron.auto_release.failed", { error: msg });
    await recordCronRun("auto-release", "error", startedAt, msg);
    return NextResponse.json(
      { success: false, error: "Job failed" },
      { status: 500 },
    );
  }
}
