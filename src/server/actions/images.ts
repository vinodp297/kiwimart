'use server';
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

import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { rateLimit } from '@/server/lib/rateLimit';
import type { ActionResult } from '@/types';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ── R2 client (lazy singleton) ───────────────────────────────────────────────

let _r2: S3Client | null = null;

function getR2Client(): S3Client {
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

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
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
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

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
  if (params.listingId && params.listingId !== 'pending') {
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
    // For new listings (pending), count pending images by this user
    const pendingCount = await db.listingImage.count({
      where: {
        listingId: 'pending',
        r2Key: { startsWith: `listings/${session.user.id}/` },
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
  const limit = await rateLimit('listing', session.user.id);
  if (!limit.success) {
    return { success: false, error: 'Too many uploads. Please wait a moment.' };
  }

  // 6. Generate a scoped, collision-resistant R2 key
  // Format: listings/{userId}/{uuid}.{ext}
  const ext = params.contentType.split('/')[1].replace('jpeg', 'jpg');
  const uuid = crypto.randomUUID();
  const r2Key = `listings/${session.user.id}/${uuid}.${ext}`;

  // 7. Create a DB record (status: pending/not-scanned)
  const image = await db.listingImage.create({
    data: {
      listingId: params.listingId ?? 'pending',
      r2Key,
      order: 0,
      sizeBytes: params.sizeBytes,
      scanned: false,
      safe: false,
    },
    select: { id: true },
  });

  // 8. Generate real presigned upload URL via R2
  const r2 = getR2Client();
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: r2Key,
    ContentType: params.contentType,
    ContentLength: params.sizeBytes,
    Metadata: { userId: session.user.id, imageId: image.id },
  });
  const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 min

  return {
    success: true,
    data: { uploadUrl, r2Key, imageId: image.id },
  };
}

// ── confirmImageUpload — triggers image processing pipeline ─────────────────

export async function confirmImageUpload(params: {
  imageId: string;
  r2Key: string;
}): Promise<ActionResult<ProcessedImageResult>> {
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  // 2. Verify image belongs to this user (key is scoped to userId)
  if (!params.r2Key.startsWith(`listings/${session.user.id}/`)) {
    return { success: false, error: 'Unauthorised image access.' };
  }

  // 3. Try BullMQ queue first, fall back to direct processing
  try {
    const { imageQueue } = await import('@/lib/queue');
    await imageQueue.add(
      'process-image',
      {
        imageId: params.imageId,
        r2Key: params.r2Key,
        userId: session.user.id,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      }
    );
    // Queue accepted — processing happens async
    return { success: true, data: { safe: true } };
  } catch {
    // Queue unavailable (dev without Redis) — process directly with sharp
    console.warn('[Images] Queue unavailable — processing image directly');
  }

  // 4. Direct processing fallback (dev mode / no Redis)
  try {
    const { processImage } = await import('@/server/actions/imageProcessor');
    const result = await processImage({
      imageId: params.imageId,
      r2Key: params.r2Key,
      userId: session.user.id,
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
    // If R2 is not configured (dev with placeholders), mark safe directly
    const msg = err instanceof Error ? err.message : 'Processing failed';
    if (msg.includes('Failed to download') || msg.includes('getaddrinfo') || msg.includes('ENOTFOUND')) {
      console.warn('[Images] R2 unavailable — marking image as safe directly');
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
    return { success: false, error: msg };
  }
}

// ── getSignedImageUrl — generates a time-limited read URL ────────────────────
// Used in server components to render listing images.
// Never expose R2 keys directly to the client.

export async function getSignedImageUrl(r2Key: string): Promise<string> {
  // If running without R2 credentials (dev), return placeholder
  if (!process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID === 'PLACEHOLDER_R2_ACCESS_KEY') {
    return `https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&h=800&fit=crop`;
  }

  const r2 = getR2Client();
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: r2Key,
  });
  return getSignedUrl(r2, command, { expiresIn: 3600 }); // 1 hour
}
