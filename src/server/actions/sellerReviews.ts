'use server';
// src/server/actions/sellerReviews.ts — thin wrapper
// Business logic delegated to ReviewService.

import { auth } from '@/lib/auth';
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
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Authentication required.' };

  const data = await reviewService.fetchSellerReviews(session.user.id);
  return { success: true, data };
}
