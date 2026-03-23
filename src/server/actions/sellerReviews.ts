'use server';
// src/server/actions/sellerReviews.ts
// ─── Fetch Seller Reviews ───────────────────────────────────────────────────

import { auth } from '@/lib/auth';
import db from '@/lib/db';
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
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  const reviews = await db.review.findMany({
    where: { sellerId: session.user.id, approved: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      rating: true,
      comment: true,
      sellerReply: true,
      createdAt: true,
      author: { select: { displayName: true } },
      order: { select: { listing: { select: { title: true } } } },
    },
  });

  return {
    success: true,
    data: reviews.map((r) => ({
      id: r.id,
      buyerName: r.author.displayName,
      rating: Math.round(r.rating / 10), // 50 → 5, 40 → 4
      comment: r.comment,
      listingTitle: r.order.listing.title,
      createdAt: r.createdAt.toISOString(),
      sellerReply: r.sellerReply,
    })),
  };
}
