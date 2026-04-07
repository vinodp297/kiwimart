"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/images.ts  (Sprint 4 + Sprint 6 — real Cloudflare R2)
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
  isSafe: boolean;
  r2Key?: string; // The processed full-size key (may differ from original)
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
        error: `File type not allowed. Accepted types: JPG, PNG, WebP.`,
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
      const _oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      await db.listingImage.deleteMany({
        where: {
          listingId: null,
          r2Key: { startsWith: `listings/${user.id}/` },
          isScanned: false,
          isSafe: false,
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
        isScanned: false,
        isSafe: false,
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
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't prepare the upload. Please try again.",
      ),
    };
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

    // 3. Process image SYNCHRONOUSLY so the frontend knows immediately
    // whether the image is safe. Previously this used BullMQ which returned
    // safe:true optimistically before processing — causing publish to fail
    // later with "images have not passed safety checks" since scanned was
    // still false in the DB. Direct inline processing ensures images are
    // fully verified before the seller can proceed past Step 1.
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
          isSafe: true,
          r2Key: result.fullKey, // Updated key after processing (e.g., uuid-full.webp)
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
            isScanned: true,
            isSafe: true,
            scannedAt: new Date(),
          },
        });
        return { success: true, data: { isSafe: true, r2Key: params.r2Key } };
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
    return {
      success: false,
      error: safeActionError(
        err,
        "Image processing encountered an issue. Please try uploading again.",
      ),
    };
  }
}

// ── cleanupOrphanedImages — removes stale pending images from old sessions ──
// Called when /sell page mounts to prevent old orphaned records from
// interfering with new uploads or publish validation.

export async function cleanupOrphanedImages(): Promise<
  ActionResult<{ deleted: number }>
> {
  try {
    const user = await requireUser();

    // Delete orphaned images for this user:
    // - Not associated with any listing (listingId is null)
    // - Unprocessed (stuck/failed processing — processedAt is null)
    // Note: ListingImage has no createdAt column, so we can only filter
    // on processedAt. We keep processed orphans since they may belong
    // to a draft being resumed in the same session.
    const result = await db.listingImage.deleteMany({
      where: {
        listingId: null,
        r2Key: { startsWith: `listings/${user.id}/` },
        processedAt: null, // Only delete unprocessed orphans
      },
    });

    if (result.count > 0) {
      logger.info("image:orphan-cleanup", {
        userId: user.id,
        deleted: result.count,
      });
    }

    return { success: true, data: { deleted: result.count } };
  } catch (err) {
    // Non-critical — don't block the user from using the page
    logger.warn("image:orphan-cleanup-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: true, data: { deleted: 0 } };
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

// ── deleteListingImage — removes an image from a listing ───────────────────

export async function deleteListingImage(params: {
  imageId: string;
  listingId: string;
}): Promise<ActionResult<{ deleted: boolean }>> {
  try {
    const user = await requireUser();

    // Verify listing ownership
    const listing = await db.listing.findUnique({
      where: { id: params.listingId },
      select: { sellerId: true, _count: { select: { images: true } } },
    });

    if (!listing || (listing.sellerId !== user.id && !user.isAdmin)) {
      return { success: false, error: "Not authorised." };
    }

    if (listing._count.images <= 1) {
      return {
        success: false,
        error: "Listings must have at least one photo.",
      };
    }

    // Delete the image record
    const image = await db.listingImage.findFirst({
      where: { id: params.imageId, listingId: params.listingId },
    });
    if (!image) {
      return { success: false, error: "Image not found." };
    }

    await db.listingImage.delete({ where: { id: params.imageId } });

    // Re-order remaining images
    const remaining = await db.listingImage.findMany({
      where: { listingId: params.listingId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    await Promise.all(
      remaining.map((img, i) =>
        db.listingImage.update({ where: { id: img.id }, data: { order: i } }),
      ),
    );

    logger.info("image:deleted", {
      imageId: params.imageId,
      listingId: params.listingId,
      userId: user.id,
    });

    return { success: true, data: { deleted: true } };
  } catch (err) {
    return { success: false, error: safeActionError(err) };
  }
}

// ── reorderListingImages — updates sort order for listing images ────────────

export async function reorderListingImages(params: {
  listingId: string;
  imageIds: string[];
}): Promise<ActionResult<{ reordered: boolean }>> {
  try {
    const user = await requireUser();

    const listing = await db.listing.findUnique({
      where: { id: params.listingId },
      select: { sellerId: true },
    });

    if (!listing || (listing.sellerId !== user.id && !user.isAdmin)) {
      return { success: false, error: "Not authorised." };
    }

    await Promise.all(
      params.imageIds.map((id, order) =>
        db.listingImage.update({
          where: { id },
          data: { order },
        }),
      ),
    );

    return { success: true, data: { reordered: true } };
  } catch (err) {
    return { success: false, error: safeActionError(err) };
  }
}
