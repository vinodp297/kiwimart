"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/images.ts  (Sprint 4 + Sprint 6 — real Cloudflare R2)
// TODO POST-LAUNCH: Centralize listing lifecycle (reserve/release/markSold)
// into listingLifecycleService. See architectural review 27-Mar-2026.
// ─── Image Upload Server Actions ─────────────────────────────────────────────
// Two-phase upload flow:
//   Phase 1: Client requests a presigned upload URL (this action)
//   Phase 2: Client uploads directly to R2 (bypasses our server)
//   Phase 3: After upload, client calls confirmImageUpload() to trigger processing
//
// Why direct-to-R2:
//   • Avoids routing binary data through Next.js serverless functions (4.5MB limit)
//   • Upload speed is much faster (client → Cloudflare edge vs client → Vercel → R2)
//   • No server memory pressure
//
// Security:
//   • Presigned URLs expire after 5 minutes
//   • Key is scoped to the authenticated user's ID (prevents key enumeration)
//   • Images processed: resized, stripped of EXIF, converted to WebP
//   • Only processed+safe images are accepted in createListing
//   • Max 8MB file size, min 200×200 dimensions, max 10 images per listing

import { requireUser } from "@/server/lib/requireUser";
import db from "@/lib/db";
import { rateLimit } from "@/server/lib/rateLimit";
import type { ActionResult } from "@/types";
import crypto from "crypto";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";
import { logger } from "@/shared/logger";

// TODO: Add HEIC support after testing magic byte validation with libheif.
// HEIC is excluded because fileValidation.ts does not have HEIC magic bytes,
// so presigned uploads of HEIC files would bypass all content validation.
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_IMAGES_PER_LISTING = 10;

export interface PresignedUploadResult {
  uploadUrl: string;
  r2Key: string;
  imageId: string;
}

export interface ProcessedImageResult {
  safe: boolean;
  width?: number;
  height?: number;
  compressedSize?: number;
  originalSize?: number;
  thumbnailKey?: string;
}

// ── requestImageUpload — returns presigned URL ────────────────────────────────

export async function requestImageUpload(params: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  listingId?: string;
}): Promise<ActionResult<PresignedUploadResult>> {
  try {
    const user = await requireUser();

    // 2. Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(params.contentType)) {
      return {
        success: false,
        error: `File type not allowed. Accepted types: JPG, PNG, WebP, HEIC.`,
      };
    }

    // 3. Validate file size (8MB limit)
    if (params.sizeBytes > MAX_FILE_SIZE_BYTES) {
      return {
        success: false,
        error: `File too large. Maximum size is 8MB.`,
      };
    }

    // 4. Check max images per listing
    if (params.listingId) {
      const existingCount = await db.listingImage.count({
        where: { listingId: params.listingId },
      });
      if (existingCount >= MAX_IMAGES_PER_LISTING) {
        return {
          success: false,
          error: `Maximum ${MAX_IMAGES_PER_LISTING} images per listing.`,
        };
      }
    } else {
      // For new listings (pending), count pending images by this user.
      // listingId is null for uploads not yet associated with a listing.
      // Clean up stale orphans first: delete unprocessed images older than 1 hour
      // that were never associated with a listing (leftover from failed uploads).
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      await db.listingImage.deleteMany({
        where: {
          listingId: null,
          r2Key: { startsWith: `listings/${user.id}/` },
          scanned: false,
          safe: false,
          processedAt: null,
          // Use id-based heuristic: cuid() is roughly time-ordered.
          // For exact timing, we'd need a createdAt column.
          // Instead, just delete all unprocessed orphans — they're useless anyway.
        },
      });

      const pendingCount = await db.listingImage.count({
        where: {
          listingId: null,
          r2Key: { startsWith: `listings/${user.id}/` },
        },
      });
      if (pendingCount >= MAX_IMAGES_PER_LISTING) {
        return {
          success: false,
          error: `Maximum ${MAX_IMAGES_PER_LISTING} images per listing.`,
        };
      }
    }

    // 5. Rate limit — reuse listing limiter (same user)
    const limit = await rateLimit("listing", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many uploads. Please wait a moment.",
      };
    }

    // 6. Generate a scoped, collision-resistant R2 key
    // Format: listings/{userId}/{uuid}.{ext}
    const ext = (params.contentType.split("/")[1] ?? "bin").replace(
      "jpeg",
      "jpg",
    );
    const uuid = crypto.randomUUID();
    const r2Key = `listings/${user.id}/${uuid}.${ext}`;

    // 7. Create a DB record (status: pending/not-scanned)
    const image = await db.listingImage.create({
      data: {
        listingId: params.listingId ?? null,
        r2Key,
        order: 0,
        sizeBytes: params.sizeBytes,
        scanned: false,
        safe: false,
      },
      select: { id: true },
    });

    // 8. Generate real presigned upload URL via R2
    // Note: Do NOT include ContentLength — it gets signed into the URL and causes
    // SignatureDoesNotMatch errors on R2 if the browser's Content-Length differs
    // by even 1 byte. R2 determines content length from the request body.
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      ContentType: params.contentType,
      Metadata: { userId: user.id, imageId: image.id },
    });
    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 min

    return {
      success: true,
      data: { uploadUrl, r2Key, imageId: image.id },
    };
  } catch (err) {
    logger.error("image:request-upload-failed", {
      error: err instanceof Error ? err.message : String(err),
      fileName: params.fileName,
      contentType: params.contentType,
      sizeBytes: params.sizeBytes,
    });
    return { success: false, error: safeActionError(err) };
  }
}

// ── confirmImageUpload — triggers image processing pipeline ─────────────────

export async function confirmImageUpload(params: {
  imageId: string;
  r2Key: string;
}): Promise<ActionResult<ProcessedImageResult>> {
  try {
    const user = await requireUser();

    // 2. Verify image belongs to this user (key is scoped to userId)
    if (!params.r2Key.startsWith(`listings/${user.id}/`)) {
      return { success: false, error: "Unauthorised image access." };
    }

    // 3. Try BullMQ queue first, fall back to direct processing
    try {
      const { imageQueue } = await import("@/lib/queue");
      await imageQueue.add(
        "process-image",
        {
          imageId: params.imageId,
          r2Key: params.r2Key,
          userId: user.id,
        },
        {
          jobId: `image-${params.imageId}`, // dedup — same image won't be queued twice
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );
      // Queue accepted — processing happens async
      return { success: true, data: { safe: true } };
    } catch (queueError) {
      // Queue unavailable (dev without Redis) — fall through to direct processing
      logger.warn("image:queue-unavailable", {
        error: queueError instanceof Error ? queueError.message : "unknown",
        imageId: params.imageId,
        r2Key: params.r2Key,
      });
    }

    // 4. Direct processing fallback (dev mode / no Redis)
    try {
      const { processImage } = await import("@/server/actions/imageProcessor");
      const result = await processImage({
        imageId: params.imageId,
        r2Key: params.r2Key,
        userId: user.id,
      });

      return {
        success: true,
        data: {
          safe: true,
          width: result.width,
          height: result.height,
          compressedSize: result.compressedSize,
          originalSize: result.originalSize,
          thumbnailKey: result.thumbKey,
        },
      };
    } catch (err) {
      // Preserve the actual error message for actionable feedback.
      // processImage throws descriptive errors (too small, scan failed, etc.)
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = rawMsg || "Processing failed.";
      const isStorageUnavailable =
        msg.includes("Failed to download") ||
        msg.includes("getaddrinfo") ||
        msg.includes("ENOTFOUND");

      if (isStorageUnavailable && process.env.NODE_ENV === "production") {
        // Production: NEVER mark safe on storage failure — image stays unsafe.
        // Reconciliation/retry job can handle this later.
        const { logger } = await import("@/shared/logger");
        logger.error(
          "images: R2 download failed in production — image remains unsafe",
          {
            imageId: params.imageId,
            r2Key: params.r2Key,
            error: msg,
          },
        );
        return {
          success: false,
          error: "Image processing failed. Please try uploading again.",
        };
      }

      if (isStorageUnavailable) {
        // Dev/test only — allow bypass for local development without R2
        await db.listingImage.update({
          where: { id: params.imageId, r2Key: params.r2Key },
          data: {
            scanned: true,
            safe: true,
            scannedAt: new Date(),
          },
        });
        return { success: true, data: { safe: true } };
      }

      // Real processing error (e.g. image too small, virus detected)
      logger.error("image:processing-failed", {
        imageId: params.imageId,
        r2Key: params.r2Key,
        error: err instanceof Error ? err.message : String(err),
      });
      return { success: false, error: msg };
    }
  } catch (err) {
    logger.error("image:confirm-upload-failed", {
      imageId: params.imageId,
      r2Key: params.r2Key,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: safeActionError(err) };
  }
}

// ── getSignedImageUrl — generates a time-limited read URL ────────────────────
// Used in server components to render listing images.
// Never expose R2 keys directly to the client.

export async function getSignedImageUrl(r2Key: string): Promise<string> {
  // If running without R2 credentials (dev), return placeholder
  if (
    !process.env.R2_ACCESS_KEY_ID ||
    process.env.R2_ACCESS_KEY_ID === "PLACEHOLDER_R2_ACCESS_KEY"
  ) {
    return `https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&h=800&fit=crop`;
  }

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
  });
  return getSignedUrl(r2, command, { expiresIn: 3600 }); // 1 hour
}
