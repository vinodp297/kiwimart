// src/modules/reviews/review.service.ts
// ─── Review Service ──────────────────────────────────────────────────────────
// Review and reply operations. Framework-free.

import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import type { CreateReviewInput, ReplyToReviewInput } from "./review.types";

export class ReviewService {
  async createReview(
    input: CreateReviewInput,
    userId: string,
  ): Promise<{ reviewId: string; sellerId: string }> {
    const order = await db.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        review: { select: { id: true } },
      },
    });

    if (!order) throw AppError.notFound("Order");
    if (order.buyerId !== userId) {
      throw AppError.unauthorised("You can only review orders you purchased.");
    }
    if (order.status !== "COMPLETED") {
      throw new AppError(
        "ORDER_WRONG_STATE",
        "You can only leave a review after the order is completed.",
        400,
      );
    }
    if (order.review) {
      throw new AppError(
        "ORDER_WRONG_STATE",
        "You have already reviewed this order.",
        400,
      );
    }

    const review = await db.review.create({
      data: {
        orderId: input.orderId,
        sellerId: order.sellerId,
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
      },
      select: { id: true },
    });

    audit({
      userId,
      action: "ORDER_STATUS_CHANGED",
      entityType: "Review",
      entityId: review.id,
      metadata: { orderId: input.orderId, rating: input.rating },
    });

    orderEventService.recordEvent({
      orderId: input.orderId,
      type: ORDER_EVENT_TYPES.REVIEW_SUBMITTED,
      actorId: userId,
      actorRole: ACTOR_ROLES.BUYER,
      summary: `Buyer left a ${input.rating}-star review`,
      metadata: { reviewId: review.id, rating: input.rating },
    });

    logger.info("review.created", {
      reviewId: review.id,
      orderId: input.orderId,
      userId,
    });

    return { reviewId: review.id, sellerId: order.sellerId };
  }

  async replyToReview(
    input: ReplyToReviewInput,
    userId: string,
  ): Promise<void> {
    const review = await db.review.findUnique({
      where: { id: input.reviewId },
      select: { id: true, sellerId: true, sellerReply: true },
    });

    if (!review) throw AppError.notFound("Review");
    if (review.sellerId !== userId) {
      throw AppError.unauthorised(
        "You can only reply to reviews of your own listings.",
      );
    }
    if (review.sellerReply) {
      throw new AppError(
        "ORDER_WRONG_STATE",
        "You have already replied to this review.",
        400,
      );
    }

    await db.review.update({
      where: { id: input.reviewId },
      data: { sellerReply: input.reply, sellerRepliedAt: new Date() },
    });

    logger.info("review.reply.added", { reviewId: input.reviewId, userId });
  }

  async fetchSellerReviews(sellerId: string) {
    const reviews = await db.review.findMany({
      where: { sellerId, approved: true },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        rating: true,
        comment: true,
        sellerReply: true,
        createdAt: true,
        author: { select: { displayName: true } },
        order: { select: { listing: { select: { title: true } } } },
        tags: { select: { tag: true } },
      },
    });

    return reviews.map((r) => ({
      id: r.id,
      buyerName: r.author.displayName,
      rating: Math.round(r.rating / 10),
      comment: r.comment,
      listingTitle: r.order.listing.title,
      createdAt: r.createdAt.toISOString(),
      sellerReply: r.sellerReply,
      tags: r.tags.map((t) => t.tag),
    }));
  }
}

export const reviewService = new ReviewService();
