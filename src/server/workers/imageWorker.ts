// src/server/workers/imageWorker.ts
// ─── Image Processing Worker ─────────────────────────────────────────────────
// Runs as a persistent background service on Render.com — started via
// src/server/workers/index.ts. See docs/RUNBOOK.md → "Worker Deployment".
//
// Processes imageQueue jobs:
//   1. Download from R2
//   2. Decodability check via sharp (see processImage — Step 2)
//   3. AV integration point — scanForMalware() (see imageProcessor.ts)
//   4. Resize with sharp (full 1200×1200 + thumb 480×480)
//   5. Convert to WebP, strip EXIF/GPS data
//   6. Re-upload processed versions to R2
//   7. Update DB: isScanned/isSafe flags, dimensions, new r2Key
//
// On validation failure: mark isSafe=false, log error
// All jobs are idempotent — re-processing overwrites the same R2 keys.

import { Worker } from "bullmq";
import { getQueueConnection, IMAGE_QUEUE_CONFIG } from "@/lib/queue";
import type { ImageJobData } from "@/lib/queue";
import { processImage } from "@/server/actions/imageProcessor";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";

export function startImageWorker() {
  if (process.env.VERCEL) {
    logger.error("worker.image.vercel_unsupported", {
      error: "Workers must run on Render.com, not Vercel. See docs/RUNBOOK.md.",
    });
    return;
  }
  const worker = new Worker<ImageJobData>(
    "image",
    async (job) => {
      const {
        imageId,
        r2Key,
        userId,
        correlationId: jobCorrelationId,
      } = job.data;
      const correlationId = jobCorrelationId ?? `job:${job.id ?? "unknown"}`;
      return runWithRequestContext({ correlationId }, async () => {
        const result = await processImage({ imageId, r2Key, userId });

        audit({
          userId,
          action: "ADMIN_ACTION",
          entityType: "ListingImage",
          entityId: imageId,
          metadata: {
            worker: "image",
            jobId: job.id,
            fullKey: result.fullKey,
            thumbKey: result.thumbKey,
            dimensions: `${result.width}×${result.height}`,
            status: "processed",
          },
        });

        return result;
      }); // end runWithRequestContext
    },
    {
      connection:
        getQueueConnection() as unknown as import("bullmq").ConnectionOptions,
      concurrency: 3, // Process 3 images at a time (memory-intensive)
      // Wire the custom jitter backoff — matching the queue's
      // defaultJobOptions.backoff.type = "custom" so BullMQ invokes this
      // strategy instead of its built-in exponential algorithm.
      settings: { backoffStrategy: IMAGE_QUEUE_CONFIG.backoffStrategy },
    },
  );

  worker.on("failed", (job, err) => {
    logger.error("image.worker.job_failed", {
      jobId: job?.id,
      imageId: job?.data?.imageId,
      error: err.message,
    });
    audit({
      action: "ADMIN_ACTION",
      metadata: {
        worker: "image",
        jobId: job?.id,
        imageId: job?.data?.imageId,
        error: err.message,
        status: "failed",
      },
    });
  });

  worker.on("completed", (job) => {
    logger.info("image.worker.job_completed", {
      jobId: job.id,
      imageId: job.data.imageId,
    });
  });

  return worker;
}
