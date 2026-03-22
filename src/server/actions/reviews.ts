'use server';
// src/server/actions/reviews.ts
// ─── Review Server Actions ────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import { createReviewSchema, sellerReplySchema } from '@/server/validators';
import type { ActionResult } from '@/types';

// ── createReview ──────────────────────────────────────────────────────────────

export async function createReview(
  raw: unknown
): Promise<ActionResult<{ reviewId: string }>> {
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  // 3. Validate
  const parsed = createReviewSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid review',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { orderId, rating, comment } = parsed.data;

  // 5a. Load order — must be completed and belong to this buyer
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      review: { select: { id: true } },
    },
  });

  if (!order) return { success: false, error: 'Order not found.' };

  // 2. Authorise
  if (order.buyerId !== session.user.id) {
    return { success: false, error: 'You can only review orders you purchased.' };
  }
  if (order.status !== 'COMPLETED') {
    return {
      success: false,
      error: 'You can only leave a review after the order is completed.',
    };
  }
  if (order.review) {
    return { success: false, error: 'You have already reviewed this order.' };
  }

  // 5b. Create review (rating stored as integer 1–50 for decimal precision)
  const review = await db.review.create({
    data: {
      orderId,
      sellerId: order.sellerId,
      authorId: session.user.id,
      rating: rating * 10, // 5 → 50, 4.5 → 45
      comment,
    },
    select: { id: true },
  });

  // 6. Audit
  audit({
    userId: session.user.id,
    action: 'ORDER_STATUS_CHANGED',
    entityType: 'Review',
    entityId: review.id,
    metadata: { orderId, rating },
  });

  revalidatePath(`/sellers/${order.sellerId}`);
  revalidatePath('/dashboard/buyer');

  return { success: true, data: { reviewId: review.id } };
}

// ── sellerReplyToReview ───────────────────────────────────────────────────────

export async function replyToReview(
  raw: unknown
): Promise<ActionResult<void>> {
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  // 3. Validate
  const parsed = sellerReplySchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: 'Invalid input' };
  }
  const { reviewId, reply } = parsed.data;

  // 5a. Load review
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { id: true, sellerId: true, sellerReply: true },
  });

  if (!review) return { success: false, error: 'Review not found.' };

  // 2. Authorise — only the reviewed seller can reply
  if (review.sellerId !== session.user.id) {
    return { success: false, error: 'You can only reply to reviews of your own listings.' };
  }
  if (review.sellerReply) {
    return { success: false, error: 'You have already replied to this review.' };
  }

  // 5b. Add reply
  await db.review.update({
    where: { id: reviewId },
    data: { sellerReply: reply, sellerRepliedAt: new Date() },
  });

  revalidatePath(`/sellers/${session.user.username}`);

  return { success: true, data: undefined };
}

