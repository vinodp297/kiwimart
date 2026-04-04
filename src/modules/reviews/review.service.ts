// src/modules/reviews/review.service.ts
// ─── Review Service ──────────────────────────────────────────────────────────
// Two-way review and reply operations. Framework-free.

import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { orderRepository } from "@/modules/orders/order.repository";
import { reviewRepository } from "./review.repository";
import type { CreateReviewInput, ReplyToReviewInput } from "./review.types";

export class ReviewService {
  async createReview(
    input: CreateReviewInput,
    userId: string,
  ): Promise<{ reviewId: string; subjectId: string }> {
    const role = input.reviewerRole ?? "BUYER";

    const order = await orderRepository.findWithReviewContext(
      input.orderId,
      role,
    );

    if (!order) throw AppError.notFound("Order");

    // Verify the caller matches the reviewer role
    if (role === "BUYER" && order.buyerId !== userId) {
      throw AppError.unauthorised("You can only review orders you purchased.");
    }
    if (role === "SELLER" && order.sellerId !== userId) {
      throw AppError.unauthorised(
        "You can only review buyers on your own orders.",
      );
    }

    if (order.status !== "COMPLETED") {
      throw new AppError(
        "ORDER_WRONG_STATE",
        "You can only leave a review after the order is completed.",
        400,
      );
    }

    if (order.reviews.length > 0) {
      throw new AppError(
        "ORDER_WRONG_STATE",
        "You have already reviewed this order.",
        400,
      );
    }

    // For BUYER reviews: subject = seller. For SELLER reviews: subject = buyer.
    const subjectId = role === "BUYER" ? order.sellerId : order.buyerId;

    const review = await reviewRepository.create({
      orderId: input.orderId,
      reviewerRole: role,
      subjectId,
      authorId: userId,
      rating: input.rating * 10, // 5 → 50, 4.5 → 45
      comment: input.comment,
      ...(input.tags && input.tags.length > 0
        ? {
            tags: {
              create: input.tags.map((tag) => ({ tag: tag as never })),
            },
          }
        : {}),
    });

    audit({
      userId,
      action: "ORDER_STATUS_CHANGED",
      entityType: "Review",
      entityId: review.id,
      metadata: {
        orderId: input.orderId,
        rating: input.rating,
        reviewerRole: role,
      },
    });

    const actorRole = role === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER;
    const label = role === "BUYER" ? "Buyer" : "Seller";

    orderEventService.recordEvent({
      orderId: input.orderId,
      type: ORDER_EVENT_TYPES.REVIEW_SUBMITTED,
      actorId: userId,
      actorRole,
      summary: `${label} left a ${input.rating}-star review`,
      metadata: {
        reviewId: review.id,
        rating: input.rating,
        reviewerRole: role,
      },
    });

    logger.info("review.created", {
      reviewId: review.id,
      orderId: input.orderId,
      userId,
      reviewerRole: role,
    });

    return { reviewId: review.id, subjectId };
  }

  async replyToReview(
    input: ReplyToReviewInput,
    userId: string,
  ): Promise<void> {
    const review = await reviewRepository.findByIdForReply(input.reviewId);

    if (!review) throw AppError.notFound("Review");
    if (review.subjectId !== userId) {
      throw AppError.unauthorised("You can only reply to reviews about you.");
    }
    if (review.reply) {
      throw new AppError(
        "ORDER_WRONG_STATE",
        "You have already replied to this review.",
        400,
      );
    }

    await reviewRepository.addReply(input.reviewId, input.reply, new Date());

    logger.info("review.reply.added", { reviewId: input.reviewId, userId });
  }

  async fetchSellerReviews(sellerId: string) {
    const reviews = await reviewRepository.findPublicSellerReviews(sellerId);

    return reviews.map((r) => ({
      id: r.id,
      buyerName: r.author.displayName,
      rating: Math.round(r.rating / 10),
      comment: r.comment,
      listingTitle: r.order.listing.title,
      createdAt: r.createdAt.toISOString(),
      sellerReply: r.reply,
      tags: r.tags.map((t) => t.tag),
    }));
  }

  async fetchBuyerReviews(buyerId: string) {
    const reviews = await reviewRepository.findPublicBuyerReviews(buyerId);

    return reviews.map((r) => ({
      id: r.id,
      sellerName: r.author.displayName,
      rating: Math.round(r.rating / 10),
      comment: r.comment,
      listingTitle: r.order.listing.title,
      createdAt: r.createdAt.toISOString(),
      buyerReply: r.reply,
    }));
  }
}

export const reviewService = new ReviewService();
