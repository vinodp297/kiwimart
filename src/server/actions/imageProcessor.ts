"use server";
// src/server/actions/imageProcessor.ts
// ─── Image Processing Pipeline ───────────────────────────────────────────────
// Steps:
//   1. Download original from R2
//   2. Decodability check — sharp validates the image can actually be decoded
//   3. AV integration point — scanForMalware() (see below for future integration)
//   4. Validate minimum dimensions (200×200)
//   5. Resize with sharp: full (1200×1200) + thumbnail (480×480)
//   6. Convert to WebP, strip EXIF (privacy — removes GPS coordinates)
//   7. Re-upload processed versions to R2
//   8. Update DB — isScanned/isSafe reflect the validation pipeline (not AV scan)
//   9. Delete original unprocessed file from R2
//
// What this pipeline checks:
//   ✓ Magic bytes validated at presigned-URL request time (fileValidation.ts)
//   ✓ File size validated at presigned-URL request time (fileValidation.ts)
//   ✓ Image is decodable by sharp (Step 2 — catches corrupt/disguised files)
//   ✓ Minimum dimensions 200×200 (Step 4)
//   ✗ Full antivirus / malware scan — NOT performed
//     See scanForMalware() below for the integration point.

import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import db from "@/lib/db";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";

export interface ProcessImageParams {
  imageId: string;
  r2Key: string;
  userId: string;
}

export interface ProcessImageResult {
  success: boolean;
  fullKey: string;
  thumbKey: string;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
}

// ── processImage — main pipeline ─────────────────────────────────────────────

export async function processImage(
  params: ProcessImageParams,
): Promise<ProcessImageResult> {
  const { imageId, r2Key, userId } = params;

  // Verify image ownership — the image record must belong to the claimed user.
  // For new listings, listingId is null (images uploaded before listing is created),
  // so we verify via the r2Key prefix which is scoped to listings/{userId}/.
  const imageRecord = await db.listingImage.findUnique({
    where: { id: imageId },
    select: { r2Key: true, listing: { select: { sellerId: true } } },
  });
  if (!imageRecord) {
    throw new Error(`Image ${imageId} not found`);
  }
  const ownerViaListing = imageRecord.listing?.sellerId === userId;
  const ownerViaKey = imageRecord.r2Key.startsWith(`listings/${userId}/`);
  if (!ownerViaListing && !ownerViaKey) {
    throw new Error(`Image ${imageId} does not belong to user ${userId}`);
  }

  // Step 1: Download original from R2
  const getCmd = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
  });
  const response = await r2.send(getCmd);
  const bodyStream = response.Body;
  if (!bodyStream) {
    throw new Error(`Failed to download image: ${r2Key}`);
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  // @ts-expect-error — AWS SDK returns a ReadableStream; iterate for Node.js
  for await (const chunk of bodyStream) {
    chunks.push(chunk as Uint8Array);
  }
  const originalBuffer = Buffer.concat(chunks);

  // Step 2: Decodability check
  // sharp.metadata() parses the image structure and validates the data. A corrupt
  // file, a server-side script with forged magic bytes, or any buffer that cannot
  // be interpreted as an image will throw here. This is the primary defence-in-depth
  // layer for malformed uploads that slip past the magic byte check at upload time.
  let origWidth = 0;
  let origHeight = 0;
  try {
    const meta = await sharp(originalBuffer).metadata();
    origWidth = meta.width ?? 0;
    origHeight = meta.height ?? 0;
  } catch {
    await db.listingImage.update({
      where: { id: imageId },
      data: { isScanned: true, isSafe: false, scannedAt: new Date() },
    });
    throw new Error(
      "Image failed decode check — file appears to be corrupt or is not a valid image.",
    );
  }

  // Step 3: AV integration point (see scanForMalware below)
  // isScanned: true on ListingImage means the image passed this validation pipeline.
  // It does NOT imply a full antivirus scan was performed.
  const scanResult = await scanForMalware(originalBuffer, r2Key);
  if (!scanResult.isSafe) {
    await db.listingImage.update({
      where: { id: imageId },
      data: { isScanned: true, isSafe: false, scannedAt: new Date() },
    });
    throw new Error(
      `Image failed security check: ${scanResult.reason ?? "unknown reason"}`,
    );
  }

  // Step 4: Validate minimum dimensions
  if (origWidth < 200 || origHeight < 200) {
    await db.listingImage.update({
      where: { id: imageId },
      data: { isScanned: true, isSafe: false, scannedAt: new Date() },
    });
    throw new Error(
      `Image too small: ${origWidth}×${origHeight} (min 200×200)`,
    );
  }

  // Step 5: Process full-size image (max 1200×1200, WebP, strip EXIF, auto-rotate)
  const fullImage = await sharp(originalBuffer)
    .rotate() // Auto-rotate based on EXIF orientation before stripping
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  // Step 6: Process thumbnail (480×480, WebP, strip EXIF)
  const thumbImage = await sharp(originalBuffer)
    .rotate()
    .resize(480, 480, { fit: "cover" })
    .webp({ quality: 75 })
    .toBuffer({ resolveWithObject: true });

  // Step 7: Generate new R2 keys for processed versions
  const basePath = r2Key.replace(/\.[^.]+$/, "");
  const fullKey = `${basePath}-full.webp`;
  const thumbKey = `${basePath}-thumb.webp`;

  // Step 8: Upload processed versions to R2
  await Promise.all([
    r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: fullKey,
        Body: fullImage.data,
        ContentType: "image/webp",
        Metadata: { userId, imageId, variant: "full" },
      }),
    ),
    r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: thumbKey,
        Body: thumbImage.data,
        ContentType: "image/webp",
        Metadata: { userId, imageId, variant: "thumb" },
      }),
    ),
  ]);

  // Step 9: Update DB record
  // isScanned: true — passed validation pipeline (magic bytes at upload + decodability here)
  // isSafe: true    — passed validation pipeline AND scanForMalware() returned safe
  // Neither flag implies a full antivirus scan was performed.
  await db.listingImage.update({
    where: { id: imageId },
    data: {
      r2Key: fullKey, // Point to processed full-size version
      thumbnailKey: thumbKey,
      width: fullImage.info.width,
      height: fullImage.info.height,
      sizeBytes: fullImage.info.size,
      originalSizeBytes: originalBuffer.length,
      processedAt: new Date(),
      isScanned: true,
      isSafe: true,
      scannedAt: new Date(),
    },
  });

  // Step 10: Delete original unprocessed file from R2
  try {
    await r2.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
      }),
    );
  } catch {
    // Non-critical — original will remain in R2 but processed versions are uploaded
  }

  return {
    success: true,
    fullKey,
    thumbKey,
    width: fullImage.info.width,
    height: fullImage.info.height,
    originalSize: originalBuffer.length,
    compressedSize: fullImage.info.size,
  };
}

// ── AV integration point ─────────────────────────────────────────────────────
// Future: replace the body of this function with a real AV service integration.
//
// Options:
//   - ClamAV (self-hosted): clamav.js npm package via a sidecar container
//   - VirusTotal API: POST /files, poll for analysis result
//   - Cloudflare Malware Scanning (R2 feature — check availability for your plan)
//   - AWS GuardDuty Malware Protection (if migrating to S3)
//
// This function is called after the decodability check (Step 2), so by the time
// execution reaches here the buffer is confirmed to be a parseable image.
//
// Semantics of ListingImage flags:
//   isScanned: true  = passed validation pipeline (magic bytes + decodability)
//   isSafe: true     = passed validation pipeline AND this function returned safe
//   Neither flag implies a full antivirus scan was performed until this
//   function is replaced with a real AV integration.

export async function scanForMalware(
  buffer: Buffer,
  filename: string,
): Promise<{ isSafe: boolean; reason?: string }> {
  // Suppress unused-variable warnings — both parameters will be passed to the
  // real AV service once integrated (see comment above).
  void buffer;
  void filename;
  // TODO: Replace with real AV service integration.
  // The decodability check (Step 2) has already confirmed this buffer is a
  // parseable image. No mock or placeholder pattern matching is performed.
  return { isSafe: true };
}
