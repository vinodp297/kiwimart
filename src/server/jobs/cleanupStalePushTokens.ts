// src/server/jobs/cleanupStalePushTokens.ts
// ─── Weekly Push Token Cleanup Job ───────────────────────────────────────────
// Hard-deletes push token rows that have been inactive for 90+ days.
// Tokens are soft-deleted (isActive: false) on sign-out; this job removes
// the rows after the retention window to prevent unbounded table growth.
//
// Schedule: weekly (Sunday 02:00 UTC is sufficient — tokens aren't time-critical)

import { notificationRepository } from "@/modules/notifications/notification.repository";
import { logger } from "@/shared/logger";

export async function cleanupStalePushTokens(): Promise<{
  deleted: number;
  errors: number;
}> {
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
}
