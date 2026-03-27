'use server';
// src/server/actions/reviews.ts — thin wrapper
// Business logic delegated to ReviewService.

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/lib/requireUser';
import { reviewService } from '@/modules/reviews/review.service';
import { createReviewSchema, sellerReplySchema } from '@/server/validators';
import type { ActionResult } from '@/types';

export async function createReview(
  raw: unknown
): Promise<ActionResult<{ reviewId: string }>> {
  try {
    const user = await requireUser();

    const parsed = createReviewSchema.safeParse(raw);
    if (!parsed.success) {
      return { success: false, error: 'Invalid review', fieldErrors: parsed.error.flatten().fieldErrors };
    }

    const result = await reviewService.createReview(parsed.data, user.id);

    revalidatePath(`/sellers/${user.id}`);
    revalidatePath('/dashboard/buyer');

    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

export async function replyToReview(
  raw: unknown
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const parsed = sellerReplySchema.safeParse(raw);
    if (!parsed.success) return { success: false, error: 'Invalid input' };

    await reviewService.replyToReview(parsed.data, user.id);

    revalidatePath('/dashboard/seller');

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}
