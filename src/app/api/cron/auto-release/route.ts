// src/app/api/cron/auto-release/route.ts
// ─── Vercel Cron — Auto-Release Escrow ───────────────────────────────────────
// Runs daily at 2:00 AM UTC (schedule: "0 2 * * *" in vercel.json).
// Sends day-2 and day-3 buyer reminders, then releases overdue escrow.
//
// Each job runs in isolation via Promise.allSettled so a failure in one
// does not prevent the others from executing.

import { NextRequest, NextResponse } from "next/server";
import { processAutoReleases } from "@/server/jobs/autoReleaseEscrow";
import { sendDeliveryReminders } from "@/server/jobs/buyerReminders";
import { sendDispatchReminders } from "@/server/jobs/dispatchReminders";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { recordCronRun } from "@/server/lib/cronLogger";
import { runCronJob } from "@/lib/cron-monitor";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

const JOB_NAMES = [
  "deliveryReminders",
  "dispatchReminders",
  "autoReleaseEscrow",
] as const;

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();

  // Run all three jobs independently — a failure in one must not skip others.
  const [deliveryResult, dispatchResult, autoReleaseResult] =
    await Promise.allSettled([
      runCronJob("deliveryReminders", sendDeliveryReminders),
      runCronJob("dispatchReminders", sendDispatchReminders),
      runCronJob("autoReleaseEscrow", processAutoReleases),
    ]);

  const allResults = [deliveryResult, dispatchResult, autoReleaseResult];

  const failed = allResults
    .map((r, i) => (r.status === "rejected" ? JOB_NAMES[i] : null))
    .filter((name): name is (typeof JOB_NAMES)[number] => name !== null);

  if (failed.length > 0) {
    logger.error("cron.auto-release.partial_failure", { failed });
    await recordCronRun(
      "auto-release",
      "error",
      startedAt,
      `Jobs failed: ${failed.join(", ")}`,
    );
  } else {
    await recordCronRun("auto-release", "success", startedAt);
  }

  return NextResponse.json({
    success: failed.length === 0,
    timestamp: new Date().toISOString(),
    results: allResults.map((r, i) => ({
      job: JOB_NAMES[i],
      status: r.status,
      ...(r.status === "fulfilled"
        ? { data: r.value }
        : {
            error:
              r.reason instanceof Error ? r.reason.message : String(r.reason),
          }),
    })),
  });
}
