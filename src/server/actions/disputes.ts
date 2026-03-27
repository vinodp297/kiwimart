'use server';
import { safeActionError } from '@/shared/errors'
// src/server/actions/disputes.ts
// ─── Dispute Server Actions — thin wrapper ──────────────────────────────────
// Business logic delegated to OrderService.

import { headers } from 'next/headers';
import { requireUser } from '@/server/lib/requireUser';
import { orderService } from '@/modules/orders/order.service';
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
});

export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;

export async function openDispute(
  raw: unknown
): Promise<ActionResult<void>> {
  try {
    const reqHeaders = await headers();
    const ip = reqHeaders.get('x-forwarded-for') ?? 'unknown';
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
