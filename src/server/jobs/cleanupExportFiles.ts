// src/server/jobs/cleanupExportFiles.ts
// ─── Export File Cleanup Job ──────────────────────────────────────────────────
// Hard-deletes data export JSON files from R2 after the 24-hour retention window.
// Files are written by export.service.ts under the exports/{userId}/ prefix.
//
// Schedule: hourly is sufficient — files should disappear within ~25 hours of
// being created regardless of when the job runs.
//
// Why not R2 lifecycle rules?
//   Cloudflare R2 lifecycle rules are configured per-bucket in the Cloudflare
//   dashboard and are not yet programmable via the S3 API at the time of writing.
//   This job is the fallback mechanism.

import { ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";

/** Retention window for export files — must match EXPORT_URL_TTL_SECONDS. */
const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function cleanupExportFiles(): Promise<{
  deleted: number;
  errors: number;
}> {
  const LOCK_KEY = "cron:cleanup-export-files";
  const LOCK_TTL_SECONDS = 300;

  const lock = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!lock) {
    logger.info("cleanup_export_files.skipped_lock_held", {
      reason:
        "Another instance is already running — skipping to prevent duplicate processing.",
    });
    return { deleted: 0, errors: 0 };
  }

  try {
    return await runWithRequestContext(
      { correlationId: `cron:cleanupExportFiles:${Date.now()}` },
      async () => {
        logger.info("job.cleanup_export_files.started");

        let deleted = 0;
        let errors = 0;

        try {
          const cutoff = new Date(Date.now() - EXPORT_RETENTION_MS);

          // List all objects under the exports/ prefix
          const listResult = await r2.send(
            new ListObjectsV2Command({
              Bucket: R2_BUCKET,
              Prefix: "exports/",
            }),
          );

          const staleObjects = (listResult.Contents ?? []).filter(
            (obj) => obj.LastModified && obj.LastModified < cutoff,
          );

          // Delete stale objects — one at a time to avoid partial failures masking errors
          await Promise.all(
            staleObjects.map(async (obj) => {
              if (!obj.Key) return;
              try {
                await r2.send(
                  new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: obj.Key }),
                );
                deleted++;
                logger.debug("job.cleanup_export_files.deleted", {
                  key: obj.Key,
                });
              } catch (err) {
                errors++;
                logger.error("job.cleanup_export_files.delete_failed", {
                  key: obj.Key,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }),
          );

          logger.info("job.cleanup_export_files.completed", {
            deleted,
            retentionHours: 24,
          });
        } catch (err) {
          errors++;
          logger.error("job.cleanup_export_files.failed", {
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
