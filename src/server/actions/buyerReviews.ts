"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/buyerReviews.ts — thin wrapper
// Fetches reviews about the current user as a buyer (written by sellers).

import { requireUser } from "@/server/lib/requireUser";
import { reviewService } from "@/modules/reviews/review.service";
import type { ActionResult } from "@/types";

interface BuyerReviewRow {
  id: string;
  sellerName: string;
  rating: number;
  comment: string;
  listingTitle: string;
  createdAt: string;
  buyerReply: string | null;
}

export async function fetchBuyerReviews(): Promise<
  ActionResult<BuyerReviewRow[]>
> {
  try {
    const user = await requireUser();
    const data = await reviewService.fetchBuyerReviews(user.id);
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't load your reviews. Please refresh the page.",
      ),
    };
  }
}
