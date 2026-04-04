import { db } from "@/lib/db";
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
  async findByIdWithRelations(id: string): Promise<ReviewWithTags | null> {
    return db.review.findUnique({
      where: { id },
      include: {
        tags: true,
        author: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarKey: true,
          },
        },
      },
    });
  },

  /** Find a review by order ID and reviewer role.
   * @source src/modules/reviews/review.service.ts */
  async findByOrderIdAndRole(
    orderId: string,
    reviewerRole: ReviewerRole,
  ): Promise<Prisma.ReviewGetPayload<{ select: { id: true } }> | null> {
    return db.review.findFirst({
      where: { orderId, reviewerRole },
      select: { id: true },
    });
  },

  /** Create a review (with optional nested tags).
   * Returns only the created id.
   * @source src/modules/reviews/review.service.ts — createReview */
  async create(
    data: Prisma.ReviewUncheckedCreateInput,
  ): Promise<{ id: string }> {
    return db.review.create({
      data,
      select: { id: true },
    });
  },

  /** Find a review by id with minimal fields needed for reply authorisation.
   * @source src/modules/reviews/review.service.ts — replyToReview */
  async findByIdForReply(
    id: string,
  ): Promise<{ id: string; subjectId: string; reply: string | null } | null> {
    return db.review.findUnique({
      where: { id },
      select: { id: true, subjectId: true, reply: true },
    });
  },

  /** Add a reply from the review subject.
   * @source src/modules/reviews/review.service.ts */
  async addReply(id: string, reply: string, repliedAt: Date): Promise<void> {
    await db.review.update({
      where: { id },
      data: { reply, repliedAt },
    });
  },

  /** Public seller-page review list (BUYER reviews about a seller).
   * Includes author display name, listing title, and tags. Approved only.
   * @source src/modules/reviews/review.service.ts — fetchSellerReviews */
  async findPublicSellerReviews(sellerId: string, take = 50) {
    return db.review.findMany({
      where: { subjectId: sellerId, reviewerRole: "BUYER", approved: true },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        rating: true,
        comment: true,
        reply: true,
        createdAt: true,
        author: { select: { displayName: true } },
        order: { select: { listing: { select: { title: true } } } },
        tags: { select: { tag: true } },
      },
    });
  },

  /** Public buyer-profile review list (SELLER reviews about a buyer).
   * @source src/modules/reviews/review.service.ts — fetchBuyerReviews */
  async findPublicBuyerReviews(buyerId: string, take = 50) {
    return db.review.findMany({
      where: { subjectId: buyerId, reviewerRole: "SELLER", approved: true },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        rating: true,
        comment: true,
        reply: true,
        createdAt: true,
        author: { select: { displayName: true } },
        order: { select: { listing: { select: { title: true } } } },
      },
    });
  },

  /** Fetch approved reviews about a user (paginated).
   * @source src/modules/reviews/review.service.ts */
  async findApprovedBySubject(
    subjectId: string,
    reviewerRole: ReviewerRole,
    take: number,
    cursor?: string,
  ): Promise<ReviewWithTags[]> {
    return db.review.findMany({
      where: { subjectId, reviewerRole, approved: true },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        tags: true,
        author: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarKey: true,
          },
        },
      },
    });
  },

  /** Count approved reviews about a user.
   * @source src/app/(public)/sellers/[username]/page.tsx */
  async countApprovedBySubject(
    subjectId: string,
    reviewerRole: ReviewerRole,
  ): Promise<number> {
    return db.review.count({
      where: { subjectId, reviewerRole, approved: true },
    });
  },

  /** Calculate average rating for a user in a given role.
   * @source src/modules/sellers/trust-score.service.ts */
  async getAverageRating(
    subjectId: string,
    reviewerRole: ReviewerRole,
  ): Promise<number | null> {
    const result = await db.review.aggregate({
      where: { subjectId, reviewerRole, approved: true },
      _avg: { rating: true },
    });
    return result._avg.rating;
  },
};
