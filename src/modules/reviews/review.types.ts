// src/modules/reviews/review.types.ts
// ─── Review Domain Types ─────────────────────────────────────────────────────

export type ReviewerRole = "BUYER" | "SELLER";

export interface CreateReviewInput {
  orderId: string;
  rating: number;
  comment: string;
  tags?: string[]; // ReviewTagType values
  reviewerRole?: ReviewerRole; // defaults to BUYER
}

export interface ReplyToReviewInput {
  reviewId: string;
  reply: string;
}
