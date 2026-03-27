'use server';
import { safeActionError } from '@/shared/errors'
// src/server/actions/disputes.ts
// ─── Dispute Server Actions ─────────────────────────────────────────────────

import { headers } from 'next/headers';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { requireUser } from '@/server/lib/requireUser';
import { getClientIp } from '@/server/lib/rateLimit';
import { orderService } from '@/modules/orders/order.service';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/infrastructure/storage/r2';
import { logger } from '@/shared/logger';
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
  evidenceUrls: z.array(z.string().url()).max(3).optional(),
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

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 3;

export async function uploadDisputeEvidence(
  formData: FormData
): Promise<ActionResult<{ urls: string[] }>> {
  try {
    const user = await requireUser();

    const files = formData.getAll('files') as File[];

    if (files.length === 0) {
      return { success: false, error: 'No files provided.' };
    }
    if (files.length > MAX_FILES) {
      return { success: false, error: `Maximum ${MAX_FILES} photos allowed.` };
    }

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return { success: false, error: 'Only JPEG, PNG and WebP images are allowed.' };
      }
      if (file.size > MAX_SIZE) {
        return { success: false, error: 'Each photo must be under 5MB.' };
      }
    }

    const uploadedUrls: string[] = [];

    for (const file of files) {
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
      const key = `disputes/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const buffer = Buffer.from(await file.arrayBuffer());

      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: file.type,
        })
      );

      const url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : key;
      uploadedUrls.push(url);
    }

    logger.info('dispute.evidence.uploaded', {
      userId: user.id,
      count: uploadedUrls.length,
    });

    return { success: true, data: { urls: uploadedUrls } };
  } catch (err) {
    logger.error('dispute.evidence.upload.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: 'Failed to upload photos. Please try again.' };
  }
}
