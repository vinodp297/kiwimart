'use server';
import { safeActionError } from '@/shared/errors'
// src/server/actions/profile-images.ts
// ─── Profile Image Upload Server Actions ─────────────────────────────────────
// Handles avatar and cover image uploads for user profiles.
//
// Flow:
//   1. Client calls requestProfileImageUpload() → gets presigned PUT URL + r2Key
//   2. Client PUTs cropped blob directly to R2 (bypasses our server)
//   3. Client calls confirmProfileImageUpload() → updates user record, deletes old key
//
// R2 key format:
//   profiles/{userId}/avatar/{uuid}.jpg
//   profiles/{userId}/cover/{uuid}.jpg

import { requireUser } from '@/server/lib/requireUser';
import db from '@/lib/db';
import { rateLimit } from '@/server/lib/rateLimit';
import type { ActionResult } from '@/types';
import crypto from 'crypto';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type ProfileImageType = 'avatar' | 'cover';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// ── requestProfileImageUpload ─────────────────────────────────────────────────

export async function requestProfileImageUpload(params: {
  contentType: string;
  sizeBytes: number;
  imageType: ProfileImageType;
}): Promise<ActionResult<{ uploadUrl: string; r2Key: string }>> {
  try {
    const user = await requireUser();

    if (!ALLOWED_TYPES.includes(params.contentType)) {
      return { success: false, error: 'File type not allowed. Use JPG, PNG or WebP.' };
    }
    if (params.sizeBytes > MAX_BYTES) {
      return { success: false, error: 'File too large. Maximum size is 5 MB.' };
    }

    const limit = await rateLimit('auth', user.id);
    if (!limit.success) {
      return {
        success: false,
        error: `Too many uploads. Try again in ${limit.retryAfter} seconds.`,
      };
    }

    const ext =
      params.contentType === 'image/png'
        ? 'png'
        : params.contentType === 'image/webp'
        ? 'webp'
        : 'jpg';
    const uuid = crypto.randomUUID();
    const r2Key = `profiles/${user.id}/${params.imageType}/${uuid}.${ext}`;

    // Lazy import so dev without R2 credentials doesn't crash on module load
    const { r2, R2_BUCKET } = await import('@/infrastructure/storage/r2');
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      ContentType: params.contentType,
      ContentLength: params.sizeBytes,
    });
    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 min

    return { success: true, data: { uploadUrl, r2Key } };
  } catch (err) {
    const msg = safeActionError(err, 'Storage unavailable.');
    // Graceful degradation when R2 is not configured (dev)
    if (msg.includes('credentials') || msg.includes('not set') || msg.includes('PLACEHOLDER')) {
      return { success: false, error: 'Image storage is not configured in this environment.' };
    }
    return { success: false, error: msg };
  }
}

// ── confirmProfileImageUpload ─────────────────────────────────────────────────

export async function confirmProfileImageUpload(params: {
  r2Key: string;
  imageType: ProfileImageType;
}): Promise<ActionResult<{ newKey: string }>> {
  try {
    const user = await requireUser();

    // Verify key is scoped to this user
    const expectedPrefix = `profiles/${user.id}/${params.imageType}/`;
    if (!params.r2Key.startsWith(expectedPrefix)) {
      return { success: false, error: 'Unauthorised image key.' };
    }

    // Fetch old key for cleanup
    const current = await db.user.findUnique({
      where: { id: user.id },
      select: { avatarKey: true, coverImageKey: true },
    });
    const oldKey =
      params.imageType === 'avatar' ? current?.avatarKey : current?.coverImageKey;

    // Update user record
    await db.user.update({
      where: { id: user.id },
      data:
        params.imageType === 'avatar'
          ? { avatarKey: params.r2Key }
          : { coverImageKey: params.r2Key },
    });

    // Delete old image from R2 (fire-and-forget, skip seed/external URLs)
    if (oldKey && oldKey.startsWith('profiles/')) {
      import('@/infrastructure/storage/r2')
        .then(({ r2, R2_BUCKET }) =>
          r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey }))
        )
        .catch(() => {});
    }

    return { success: true, data: { newKey: params.r2Key } };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err),
    };
  }
}
