// src/server/lib/cronLogger.ts
// ─── Cron job logger ─────────────────────────────────────────────────────────
// Writes a CronLog row for each scheduled job run. Failures are swallowed
// so logging can never break a cron handler.

import db from "@/lib/db";
import { logger } from "@/shared/logger";

export async function recordCronRun(
  jobName: string,
  status: "success" | "error",
  startedAt: Date,
  detail?: string,
): Promise<void> {
  try {
    const finishedAt = new Date();
    await db.cronLog.create({
      data: {
        jobName,
        status,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        detail: detail ? detail.slice(0, 500) : null,
      },
    });
  } catch (err) {
    logger.warn("cron.log.write_failed", {
      jobName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
