import { Prisma } from "@prisma/client";
import type { ReviewerRole } from "./review.types";

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
  async findByIdWithRelations(_id: string): Promise<ReviewWithTags | null> {
    // TODO: move from src/modules/reviews/review.service.ts
    throw new Error("Not implemented");
  },

  /** Find a review by order ID and reviewer role.
   * @source src/modules/reviews/review.service.ts */
  async findByOrderIdAndRole(
    _orderId: string,
    _reviewerRole: ReviewerRole,
  ): Promise<Prisma.ReviewGetPayload<{ select: { id: true } }> | null> {
    // TODO: move from src/modules/reviews/review.service.ts
    throw new Error("Not implemented");
  },

  /** Create a review with tags.
   * @source src/modules/reviews/review.service.ts */
  async create(_data: Prisma.ReviewCreateInput): Promise<ReviewWithTags> {
    // TODO: move from src/modules/reviews/review.service.ts
    throw new Error("Not implemented");
  },

  /** Add a reply from the review subject.
   * @source src/modules/reviews/review.service.ts */
  async addReply(_id: string, _reply: string, _repliedAt: Date): Promise<void> {
    // TODO: move from src/modules/reviews/review.service.ts
    throw new Error("Not implemented");
  },

  /** Fetch approved reviews about a user (paginated).
   * @source src/modules/reviews/review.service.ts */
  async findApprovedBySubject(
    _subjectId: string,
    _reviewerRole: ReviewerRole,
    _take: number,
    _cursor?: string,
  ): Promise<ReviewWithTags[]> {
    // TODO: move from src/modules/reviews/review.service.ts
    throw new Error("Not implemented");
  },

  /** Count approved reviews about a user.
   * @source src/app/(public)/sellers/[username]/page.tsx */
  async countApprovedBySubject(
    _subjectId: string,
    _reviewerRole: ReviewerRole,
  ): Promise<number> {
    // TODO: move from src/app/(public)/sellers/[username]/page.tsx
    throw new Error("Not implemented");
  },

  /** Calculate average rating for a user in a given role.
   * @source src/modules/sellers/trust-score.service.ts */
  async getAverageRating(
    _subjectId: string,
    _reviewerRole: ReviewerRole,
  ): Promise<number | null> {
    // TODO: move from src/modules/sellers/trust-score.service.ts
    throw new Error("Not implemented");
  },
};
