// src/server/workers/imageWorker.ts
// ─── Image Processing Worker ─────────────────────────────────────────────────
// STATUS: INACTIVE on production Vercel. Requires persistent process.
// Images are currently processed inline via processImage() server action.
// To activate: Deploy separately — see emailWorker.ts header for details.
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
import { getQueueConnection } from "@/lib/queue";
import type { ImageJobData } from "@/lib/queue";
import { processImage } from "@/server/actions/imageProcessor";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";

export function startImageWorker() {
  if (process.env.VERCEL) {
    console.error(
      "worker.image: BullMQ workers cannot run on Vercel serverless.",
    );
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
