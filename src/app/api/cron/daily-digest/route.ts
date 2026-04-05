// src/app/api/cron/daily-digest/route.ts
import { NextResponse } from "next/server";
import { sendDailyDigest } from "@/server/jobs/dailyDigest";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { recordCronRun } from "@/server/lib/cronLogger";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  try {
    await sendDailyDigest();
    await recordCronRun("daily-digest", "success", startedAt);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("daily_digest.cron_error", { error: msg });
    await recordCronRun("daily-digest", "error", startedAt, msg);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
