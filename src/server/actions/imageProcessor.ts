'use server';
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

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import db from '@/lib/db';

// ── R2 client ────────────────────────────────────────────────────────────────

let _r2: S3Client | null = null;

function getR2(): S3Client {
  if (!_r2) {
    _r2 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _r2;
}

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
}

// ── processImage — main pipeline ─────────────────────────────────────────────

export async function processImage(params: ProcessImageParams): Promise<ProcessImageResult> {
  const { imageId, r2Key, userId } = params;
  const r2 = getR2();

  // 1. Download original from R2
  const getCmd = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
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
      data: { scanned: true, safe: false, scannedAt: new Date() },
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
      data: { scanned: true, safe: false, scannedAt: new Date() },
    });
    throw new Error(`Image too small: ${origWidth}×${origHeight} (min 200×200)`);
  }

  // 4. Process full-size image (max 1200×1200, WebP, strip EXIF)
  const fullImage = await sharp(originalBuffer)
    .rotate() // Auto-rotate based on EXIF orientation before stripping
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  // 5. Process thumbnail (480×480, WebP, strip EXIF)
  const thumbImage = await sharp(originalBuffer)
    .rotate()
    .resize(480, 480, { fit: 'cover' })
    .webp({ quality: 75 })
    .toBuffer({ resolveWithObject: true });

  // 6. Generate new R2 keys for processed versions
  const basePath = r2Key.replace(/\.[^.]+$/, '');
  const fullKey = `${basePath}-full.webp`;
  const thumbKey = `${basePath}-thumb.webp`;

  // 7. Upload processed versions to R2
  await Promise.all([
    r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: fullKey,
        Body: fullImage.data,
        ContentType: 'image/webp',
        Metadata: { userId, imageId, variant: 'full' },
      })
    ),
    r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: thumbKey,
        Body: thumbImage.data,
        ContentType: 'image/webp',
        Metadata: { userId, imageId, variant: 'thumb' },
      })
    ),
  ]);

  // 8. Update DB record
  await db.listingImage.update({
    where: { id: imageId },
    data: {
      r2Key: fullKey, // Point to processed full-size version
      width: fullImage.info.width,
      height: fullImage.info.height,
      sizeBytes: fullImage.info.size,
      scanned: true,
      safe: true,
      scannedAt: new Date(),
    },
  });

  return {
    success: true,
    fullKey,
    thumbKey,
    width: fullImage.info.width,
    height: fullImage.info.height,
  };
}

// ── Mock ClamAV scan ─────────────────────────────────────────────────────────
// Sprint 5: Replace with real ClamAV integration (clamav.js or HTTP API)

function mockClamAVScan(buffer: Buffer): { clean: boolean; threat?: string } {
  // Check for EICAR test string (standard antivirus test pattern)
  const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  if (buffer.toString('utf8', 0, Math.min(buffer.length, 100)).includes(eicar)) {
    return { clean: false, threat: 'EICAR-Test-File' };
  }
  return { clean: true };
}
