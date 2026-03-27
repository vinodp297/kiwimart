'use server';
import { safeActionError } from '@/shared/errors'
// src/server/actions/sellerReviews.ts — thin wrapper
// Business logic delegated to ReviewService.

import { requireUser } from '@/server/lib/requireUser';
import { reviewService } from '@/modules/reviews/review.service';
import type { ActionResult } from '@/types';

interface SellerReviewRow {
  id: string;
  buyerName: string;
  rating: number;
  comment: string;
  listingTitle: string;
  createdAt: string;
  sellerReply: string | null;
}

export async function fetchSellerReviews(): Promise<ActionResult<SellerReviewRow[]>> {
  try {
    const user = await requireUser();
    const data = await reviewService.fetchSellerReviews(user.id);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: safeActionError(err) };
  }
}
