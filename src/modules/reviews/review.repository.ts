import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Review repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/modules/reviews/review.service.ts
//   - src/server/actions/reviews.ts
//   - src/server/actions/sellerReviews.ts
// ---------------------------------------------------------------------------

export type ReviewWithTags = Prisma.ReviewGetPayload<{
  include: {
    tags: true;
    author: {
      select: { id: true; displayName: true; username: true; avatarKey: true };
    };
  };
}>;

export const reviewRepository = {
  /** Find a review by ID with author and tags.
   * @source src/modules/reviews/review.service.ts */
  async findByIdWithRelations(id: string): Promise<ReviewWithTags | null> {
    // TODO: move from src/modules/reviews/review.service.ts
    throw new Error("Not implemented");
  },

  /** Find a review by order ID (to check if already reviewed).
   * @source src/modules/reviews/review.service.ts */
  async findByOrderId(
    orderId: string,
  ): Promise<Prisma.ReviewGetPayload<{ select: { id: true } }> | null> {
    // TODO: move from src/modules/reviews/review.service.ts
    throw new Error("Not implemented");
  },

  /** Create a review with tags.
   * @source src/modules/reviews/review.service.ts */
  async create(data: Prisma.ReviewCreateInput): Promise<ReviewWithTags> {
    // TODO: move from src/modules/reviews/review.service.ts
    throw new Error("Not implemented");
  },

  /** Add a seller reply to a review.
   * @source src/modules/reviews/review.service.ts */
  async addSellerReply(
    id: string,
    reply: string,
    repliedAt: Date,
  ): Promise<void> {
    // TODO: move from src/modules/reviews/review.service.ts
    throw new Error("Not implemented");
  },

  /** Fetch approved reviews for a seller (paginated).
   * @source src/modules/reviews/review.service.ts */
  async findApprovedBySeller(
    sellerId: string,
    take: number,
    cursor?: string,
  ): Promise<ReviewWithTags[]> {
    // TODO: move from src/modules/reviews/review.service.ts
    throw new Error("Not implemented");
  },

  /** Count approved reviews for a seller.
   * @source src/app/(public)/sellers/[username]/page.tsx */
  async countApprovedBySeller(sellerId: string): Promise<number> {
    // TODO: move from src/app/(public)/sellers/[username]/page.tsx
    throw new Error("Not implemented");
  },

  /** Calculate average rating for a seller.
   * @source src/modules/sellers/trust-score.service.ts */
  async getAverageRating(sellerId: string): Promise<number | null> {
    // TODO: move from src/modules/sellers/trust-score.service.ts
    throw new Error("Not implemented");
  },
};
