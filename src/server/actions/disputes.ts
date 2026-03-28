'use server';
import { safeActionError } from '@/shared/errors'
// src/server/actions/disputes.ts
// ─── Dispute Server Actions ─────────────────────────────────────────────────

import { headers } from 'next/headers';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { requireUser } from '@/server/lib/requireUser';
import { rateLimit, getClientIp } from '@/server/lib/rateLimit';
import { validateImageFile } from '@/server/lib/fileValidation';
import { orderService } from '@/modules/orders/order.service';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2, R2_BUCKET } from '@/infrastructure/storage/r2';
import { logger } from '@/shared/logger';
import db from '@/lib/db';
import type { ActionResult } from '@/types';
import { z } from 'zod';

const openDisputeSchema = z.object({
  orderId: z.string().min(1),
  reason: z.enum([
    'ITEM_NOT_RECEIVED',
    'ITEM_NOT_AS_DESCRIBED',
    'ITEM_DAMAGED',
    'WRONG_ITEM_SENT',
    'COUNTERFEIT_ITEM',
    'SELLER_UNRESPONSIVE',
    'SELLER_CANCELLED',
    'REFUND_NOT_PROCESSED',
    'OTHER',
  ]),
  description: z.string().min(20, 'Please describe the issue in at least 20 characters.').max(2000).trim(),
  evidenceUrls: z.array(z.string().min(1)).max(3).optional(),
});

export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;

export async function openDispute(
  raw: unknown
): Promise<ActionResult<void>> {
  try {
    const reqHeaders = await headers();
    // Use getClientIp() — x-forwarded-for is client-controllable and spoofable.
    const ip = getClientIp(reqHeaders as unknown as Headers);
    const user = await requireUser();

    // Rate limit — 3 disputes per day per user
    const limit = await rateLimit('disputes', user.id);
    if (!limit.success) {
      return {
        success: false,
        error: 'You have opened too many disputes today. Please contact support if you need further assistance.',
      };
    }

    // Abuse detection — log warning if user has 5+ disputes in 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentDisputeCount = await db.order.count({
      where: {
        buyerId: user.id,
        disputeOpenedAt: { not: null, gte: thirtyDaysAgo },
      },
    });
    if (recentDisputeCount >= 5) {
      logger.warn('dispute.abuse_detected', {
        userId: user.id,
        recentDisputeCount,
        ip,
      });
    }

    const parsed = openDisputeSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: 'Invalid dispute details.',
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    await orderService.openDispute(parsed.data, user.id, ip);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: safeActionError(err) };
  }
}

// ── Dispute evidence photo upload ──────────────────────────────────────────
// SECURITY: Evidence is stored as R2 keys (NOT public URLs). Signed URLs are
// generated on-demand via getDisputeEvidenceUrls() for display in the UI.
// This prevents dispute evidence from being publicly accessible.

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 3;

export async function uploadDisputeEvidence(
  formData: FormData
): Promise<ActionResult<{ urls: string[] }>> {
  try {
    const user = await requireUser();

    // Rate limit — 10 upload calls per hour per user
    const uploadLimit = await rateLimit('disputes', user.id);
    if (!uploadLimit.success) {
      return { success: false, error: 'Too many uploads. Please try again later.' };
    }

    const files = formData.getAll('files') as File[];

    if (files.length === 0) {
      return { success: false, error: 'No files provided.' };
    }
    if (files.length > MAX_FILES) {
      return { success: false, error: `Maximum ${MAX_FILES} photos allowed.` };
    }

    const uploadedKeys: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());

      // Server-side security validation — magic bytes + extension + size + MIME type
      const validation = validateImageFile({
        buffer,
        mimetype: file.type,
        size: file.size,
        originalname: file.name,
      });
      if (!validation.valid) {
        return { success: false, error: validation.error ?? 'Invalid file.' };
      }

      if (file.size > MAX_SIZE) {
        return { success: false, error: 'Each photo must be under 5MB.' };
      }

      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
      const key = `disputes/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: file.type,
        })
      );

      // Store the R2 key (NOT a public URL) — signed URLs generated at serve time
      uploadedKeys.push(key);
    }

    logger.info('dispute.evidence.uploaded', {
      userId: user.id,
      count: uploadedKeys.length,
    });

    // Return keys in the `urls` field for backward-compat with the client
    return { success: true, data: { urls: uploadedKeys } };
  } catch (err) {
    logger.error('dispute.evidence.upload.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: 'Failed to upload photos. Please try again.' };
  }
}

// ── Generate signed URLs for dispute evidence display ─────────────────────
// Called by server components / admin pages to display evidence securely.
// Each signed URL is valid for 1 hour.

export async function getDisputeEvidenceUrls(
  r2Keys: string[]
): Promise<string[]> {
  return Promise.all(
    r2Keys.map(async (key) => {
      // If the stored value is already a full URL (legacy data), pass through
      if (key.startsWith('http')) return key

      const command = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
      return getSignedUrl(r2, command, { expiresIn: 3600 })
    })
  )
}
