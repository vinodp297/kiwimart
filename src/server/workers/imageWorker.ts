// src/server/workers/imageWorker.ts  (Sprint 4)
// ─── Image Processing Worker ─────────────────────────────────────────────────
// Processes imageQueue jobs:
//   1. Download from R2
//   2. Mock ClamAV scan (Sprint 5: real virus scanning)
//   3. Resize with sharp (full 1200×1200 + thumb 480×480)
//   4. Convert to WebP, strip EXIF/GPS data
//   5. Re-upload processed versions to R2
//   6. Update DB: safe=true, dimensions, new r2Key
//
// On scan failure: mark safe=false, log to audit (Sprint 5: notify admin)
// All jobs are idempotent — re-processing overwrites the same R2 keys.

import { Worker } from 'bullmq';
import { getRedisConnection } from '@/lib/queue';
import type { ImageJobData } from '@/lib/queue';
import { processImage } from '@/server/actions/imageProcessor';
import { audit } from '@/server/lib/audit';

export function startImageWorker() {
  const worker = new Worker<ImageJobData>(
    'image',
    async (job) => {
      const { imageId, r2Key, userId } = job.data;

      const result = await processImage({ imageId, r2Key, userId });

      audit({
        userId,
        action: 'ADMIN_ACTION',
        entityType: 'ListingImage',
        entityId: imageId,
        metadata: {
          worker: 'image',
          jobId: job.id,
          fullKey: result.fullKey,
          thumbKey: result.thumbKey,
          dimensions: `${result.width}×${result.height}`,
          status: 'processed',
        },
      });

      return result;
    },
    {
      connection: getRedisConnection(),
      concurrency: 3, // Process 3 images at a time (memory-intensive)
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[ImageWorker] Job ${job?.id} failed:`, err.message);
    audit({
      action: 'ADMIN_ACTION',
      metadata: {
        worker: 'image',
        jobId: job?.id,
        imageId: job?.data?.imageId,
        error: err.message,
        status: 'failed',
      },
    });
  });

  worker.on('completed', (job) => {
    console.log(`[ImageWorker] Job ${job.id} completed — image ${job.data.imageId}`);
  });

  return worker;
}
