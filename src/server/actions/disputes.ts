'use server';
// src/server/actions/disputes.ts
// ─── Dispute Server Actions ─────────────────────────────────────────────────
// Security:
//   • Only the buyer of an order can open a dispute
//   • Must be within 14 days of dispatch
//   • Order must be in DISPATCHED or DELIVERED status

import { headers } from 'next/headers';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import { requireUser } from '@/server/lib/requireUser';
import type { ActionResult } from '@/types';
import { z } from 'zod';

const openDisputeSchema = z.object({
  orderId: z.string().min(1),
  reason: z.enum([
    'ITEM_NOT_RECEIVED',
    'ITEM_NOT_AS_DESCRIBED',
    'ITEM_DAMAGED',
    'SELLER_UNRESPONSIVE',
    'OTHER',
  ]),
  description: z.string().min(20, 'Please describe the issue in at least 20 characters.').max(2000).trim(),
});

export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;

export async function openDispute(
  raw: unknown
): Promise<ActionResult<void>> {
  const reqHeaders = await headers();
  const ip = reqHeaders.get('x-forwarded-for') ?? 'unknown';

  // 1. Authenticate + ban check
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Authentication required.' };
  }

  // 3. Validate
  const parsed = openDisputeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid dispute details.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { orderId, reason, description } = parsed.data;

  // 5a. Load order
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      dispatchedAt: true,
      disputeOpenedAt: true,
      listing: { select: { title: true } },
      seller: { select: { email: true, displayName: true } },
    },
  });

  if (!order) return { success: false, error: 'Order not found.' };

  // 2. Authorise — buyer only
  if (order.buyerId !== user.id) {
    return { success: false, error: 'Only the buyer can open a dispute.' };
  }

  // Check eligible status
  if (order.status !== 'DISPATCHED' && order.status !== 'DELIVERED') {
    return {
      success: false,
      error: 'Disputes can only be opened for dispatched or delivered orders.',
    };
  }

  // Already disputed
  if (order.disputeOpenedAt) {
    return { success: false, error: 'A dispute has already been opened for this order.' };
  }

  // 4. Time check — within 14 days of dispatch
  if (order.dispatchedAt) {
    const daysSinceDispatch =
      (Date.now() - order.dispatchedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDispatch > 14) {
      return {
        success: false,
        error: 'Disputes must be opened within 14 days of dispatch.',
      };
    }
  }

  // 5b. Update order to DISPUTED
  await db.order.update({
    where: { id: orderId },
    data: {
      status: 'DISPUTED',
      disputeReason: reason,
      disputeOpenedAt: new Date(),
      disputeNotes: description,
    },
  });

  // 5c. Notify seller + admin via email queue
  try {
    const { emailQueue } = await import('@/lib/queue');
    await emailQueue.add('disputeOpened', {
      type: 'disputeOpened' as const,
      payload: {
        to: order.seller.email,
        sellerName: order.seller.displayName,
        listingTitle: order.listing.title,
        reason,
        description,
        orderUrl: `${process.env.NEXT_PUBLIC_APP_URL}/orders/${orderId}`,
      },
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
  } catch {
    // Queue not available — log for manual follow-up
    console.warn('[Disputes] Failed to queue dispute notification email');
  }

  // 6. Audit
  audit({
    userId: user.id,
    action: 'DISPUTE_OPENED',
    entityType: 'Order',
    entityId: orderId,
    metadata: { reason, description: description.slice(0, 100) },
    ip,
  });

  return { success: true, data: undefined };
}
