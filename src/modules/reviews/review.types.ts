// src/modules/reviews/review.types.ts
// ─── Review Domain Types ─────────────────────────────────────────────────────

export interface CreateReviewInput {
  orderId: string
  rating: number
  comment: string
}

export interface ReplyToReviewInput {
  reviewId: string
  reply: string
}
