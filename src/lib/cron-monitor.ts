// src/lib/cron-monitor.ts
// ─── Cron job wrapper with Sentry alerting ───────────────────────────────────
// Wraps a cron job function so that:
//  • completion is logged with durationMs at info level
//  • failure is logged at error level, captured in Sentry with a `cronJob`
//    tag for operator filtering, then re-thrown so the caller still knows
//    the job failed (and can still run its own bookkeeping / HTTP response).
//
// The existing logger already forwards error events to Sentry, but we call
// captureException here explicitly so the alert carries the cronJob tag and
// the durationMs extra — these are critical for triage.

import { logger } from "@/shared/logger";

export type CronJobResult = {
  [key: string]: unknown;
};

/**
 * Run a cron job function with structured logging + Sentry alerting on failure.
 * The wrapped function's return value is surfaced in the completed log entry.
 * Any thrown error is logged, reported to Sentry with the cronJob tag, then
 * re-thrown so the caller learns that the job failed.
 */
export async function runCronJob<T extends CronJobResult | void>(
  jobName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startMs = Date.now();

  try {
    const result = await fn();
    const durationMs = Date.now() - startMs;

    logger.info(`cron.${jobName}.completed`, {
      ...(result ?? {}),
      durationMs,
      jobName,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const message = error instanceof Error ? error.message : String(error);

    logger.error(`cron.${jobName}.failed`, {
      error: message,
      durationMs,
      jobName,
    });

    // Explicit Sentry alert with cronJob tag so operators can filter by job
    // name in the Sentry dashboard. Fire-and-forget — do not block re-throw.
    import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureException(error, {
          tags: { cronJob: jobName },
          extra: { durationMs, jobName },
          level: "error",
        });
      })
      .catch(() => {
        // Sentry unavailable — structured log above still reaches the logger
      });

    // Re-throw so the caller can still perform its own failure bookkeeping
    // (recordCronRun, HTTP 500 response, etc.)
    throw error;
  }
}
