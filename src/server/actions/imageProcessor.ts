"use server";
// src/server/actions/imageProcessor.ts  (Sprint 4)
// ─── Image Processing Pipeline ───────────────────────────────────────────────
// Called by the BullMQ image worker after upload confirmation.
// Steps:
//   1. Download original from R2
//   2. Mock ClamAV scan (Sprint 5: real virus scanning)
//   3. Resize with sharp: full (1200×1200) + thumbnail (480×480)
//   4. Convert to WebP for efficiency
//   5. Strip EXIF data (privacy — remove GPS coordinates)
//   6. Re-upload processed versions to R2
//   7. Update DB with dimensions + safe=true

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

  // 1. Download original from R2
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

  // 2. Mock ClamAV scan (Sprint 5: integrate real ClamAV via clamav.js or API)
  const scanResult = mockClamAVScan(originalBuffer);
  if (!scanResult.clean) {
    // Mark as unsafe in DB
    await db.listingImage.update({
      where: { id: imageId },
      data: { isScanned: true, isSafe: false, scannedAt: new Date() },
    });
    throw new Error(`Image failed virus scan: ${scanResult.threat}`);
  }

  // 3. Get metadata and validate dimensions
  const metadata = await sharp(originalBuffer).metadata();
  const origWidth = metadata.width ?? 0;
  const origHeight = metadata.height ?? 0;

  if (origWidth < 200 || origHeight < 200) {
    await db.listingImage.update({
      where: { id: imageId },
      data: { isScanned: true, isSafe: false, scannedAt: new Date() },
    });
    throw new Error(
      `Image too small: ${origWidth}×${origHeight} (min 200×200)`,
    );
  }

  // 4. Process full-size image (max 1200×1200, WebP, strip EXIF, progressive)
  const fullImage = await sharp(originalBuffer)
    .rotate() // Auto-rotate based on EXIF orientation before stripping
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  // 5. Process thumbnail (480×480, WebP, strip EXIF)
  const thumbImage = await sharp(originalBuffer)
    .rotate()
    .resize(480, 480, { fit: "cover" })
    .webp({ quality: 75 })
    .toBuffer({ resolveWithObject: true });

  // 6. Generate new R2 keys for processed versions
  const basePath = r2Key.replace(/\.[^.]+$/, "");
  const fullKey = `${basePath}-full.webp`;
  const thumbKey = `${basePath}-thumb.webp`;

  // 7. Upload processed versions to R2
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

  // 8. Update DB record
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

  // 9. Delete original unprocessed file from R2
  try {
    await r2.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
      }),
    );
  } catch {
    // Failed to delete original — non-critical
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

// ── Mock ClamAV scan ─────────────────────────────────────────────────────────
// Sprint 5: Replace with real ClamAV integration (clamav.js or HTTP API)

function mockClamAVScan(buffer: Buffer): { clean: boolean; threat?: string } {
  // Check for EICAR test string (standard antivirus test pattern)
  const eicar =
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  if (
    buffer.toString("utf8", 0, Math.min(buffer.length, 100)).includes(eicar)
  ) {
    return { clean: false, threat: "EICAR-Test-File" };
  }
  return { clean: true };
}
