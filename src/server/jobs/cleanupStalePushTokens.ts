// src/server/jobs/cleanupStalePushTokens.ts
// ─── Weekly Push Token Cleanup Job ───────────────────────────────────────────
// Hard-deletes push token rows that have been inactive for 90+ days.
// Tokens are soft-deleted (isActive: false) on sign-out; this job removes
// the rows after the retention window to prevent unbounded table growth.
//
// Schedule: weekly (Sunday 02:00 UTC is sufficient — tokens aren't time-critical)

import { notificationRepository } from "@/modules/notifications/notification.repository";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";

export async function cleanupStalePushTokens(): Promise<{
  deleted: number;
  errors: number;
}> {
  const LOCK_KEY = "cron:cleanup-stale-push-tokens";
  const LOCK_TTL_SECONDS = 300;

  const lock = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!lock) {
    logger.info("cleanup_stale_push_tokens.skipped_lock_held", {
      reason:
        "Another instance is already running — skipping to prevent duplicate processing.",
    });
    return { deleted: 0, errors: 0 };
  }

  try {
    return await runWithRequestContext(
      { correlationId: `cron:cleanupStalePushTokens:${Date.now()}` },
      async () => {
        logger.info("job.cleanup_stale_push_tokens.started");

        let deleted = 0;
        let errors = 0;

        try {
          deleted = await notificationRepository.deleteInactivePushTokens();

          logger.info("job.cleanup_stale_push_tokens.completed", {
            deleted,
            retentionDays: 90,
          });
        } catch (err) {
          errors++;
          logger.error("job.cleanup_stale_push_tokens.failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        return { deleted, errors };
      }, // end runWithRequestContext fn
    ); // end runWithRequestContext
  } finally {
    await releaseLock(LOCK_KEY, lock);
  }
}
