"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/storage.ts  (Sprint 6 — storage monitoring)
// ─── Storage Monitoring ─────────────────────────────────────────────────────

import { requireUser } from "@/server/lib/requireUser";
import db from "@/lib/db";
import type { ActionResult } from "@/types";

export interface StorageStats {
  totalImages: number;
  processedImages: number;
  pendingImages: number;
  totalSizeBytes: number;
  totalOriginalSizeBytes: number;
  compressionSavingsBytes: number;
  compressionRatio: number;
  thumbnailCount: number;
  averageSizeBytes: number;
}

export async function getStorageStats(): Promise<ActionResult<StorageStats>> {
  try {
    const user = await requireUser();
    if (!user.isAdmin) {
      return { success: false, error: "Admin access required." };
    }

    const [totalImages, processedImages, pendingImages, thumbnailCount] =
      await Promise.all([
        db.listingImage.count(),
        db.listingImage.count({ where: { processedAt: { not: null } } }),
        db.listingImage.count({ where: { isScanned: false } }),
        db.listingImage.count({ where: { thumbnailKey: { not: null } } }),
      ]);

    // Aggregate sizes
    const sizeAgg = await db.listingImage.aggregate({
      _sum: {
        sizeBytes: true,
        originalSizeBytes: true,
      },
      _avg: {
        sizeBytes: true,
      },
    });

    const totalSizeBytes = sizeAgg._sum.sizeBytes ?? 0;
    const totalOriginalSizeBytes = sizeAgg._sum.originalSizeBytes ?? 0;
    const compressionSavingsBytes =
      totalOriginalSizeBytes > 0 ? totalOriginalSizeBytes - totalSizeBytes : 0;
    const compressionRatio =
      totalOriginalSizeBytes > 0
        ? Number(
            ((1 - totalSizeBytes / totalOriginalSizeBytes) * 100).toFixed(1),
          )
        : 0;
    const averageSizeBytes = Math.round(sizeAgg._avg.sizeBytes ?? 0);

    return {
      success: true,
      data: {
        totalImages,
        processedImages,
        pendingImages,
        totalSizeBytes,
        totalOriginalSizeBytes,
        compressionSavingsBytes,
        compressionRatio,
        thumbnailCount,
        averageSizeBytes,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "The file couldn't be uploaded. Please try again.",
      ),
    };
  }
}
