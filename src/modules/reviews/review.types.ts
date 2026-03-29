// src/modules/reviews/review.types.ts
// ─── Review Domain Types ─────────────────────────────────────────────────────

export interface CreateReviewInput {
  orderId: string;
  rating: number;
  comment: string;
  tags?: string[]; // ReviewTagType values
}

export interface ReplyToReviewInput {
  reviewId: string;
  reply: string;
}
