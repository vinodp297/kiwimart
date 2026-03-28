// src/test/review.service.test.ts
// ─── Tests for ReviewService ────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { reviewService } from "@/modules/reviews/review.service";
import db from "@/lib/db";
import { AppError } from "@/shared/errors";

describe("ReviewService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createReview ──────────────────────────────────────────────────────────

  describe("createReview", () => {
    const mockOrder = {
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "COMPLETED",
      review: null,
    };

    it("creates review for completed order", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder as never);
      vi.mocked(db.review.create).mockResolvedValue({
        id: "review-1",
      } as never);

      const result = await reviewService.createReview(
        { orderId: "order-1", rating: 4.5, comment: "Great seller!" },
        "buyer-1",
      );

      expect(result.reviewId).toBe("review-1");
      expect(db.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: "order-1",
            sellerId: "seller-1",
            authorId: "buyer-1",
            rating: 45, // 4.5 * 10
            comment: "Great seller!",
          }),
        }),
      );
    });

    it("rejects review for non-completed order", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        ...mockOrder,
        status: "DISPATCHED",
      } as never);

      await expect(
        reviewService.createReview(
          { orderId: "order-1", rating: 5, comment: "Great!" },
          "buyer-1",
        ),
      ).rejects.toThrow("completed");
    });

    it("rejects duplicate review", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue({
        ...mockOrder,
        review: { id: "existing-review" },
      } as never);

      await expect(
        reviewService.createReview(
          { orderId: "order-1", rating: 5, comment: "Great!" },
          "buyer-1",
        ),
      ).rejects.toThrow("already reviewed");
    });

    it("rejects if buyer does not own order", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder as never);

      await expect(
        reviewService.createReview(
          { orderId: "order-1", rating: 5, comment: "Great!" },
          "wrong-buyer",
        ),
      ).rejects.toThrow("only review orders you purchased");
    });

    it("throws NOT_FOUND when order does not exist", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(null);

      await expect(
        reviewService.createReview(
          { orderId: "nope", rating: 5, comment: "Great!" },
          "buyer-1",
        ),
      ).rejects.toThrow(AppError);
    });

    it("multiplies rating by 10 for storage", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder as never);
      vi.mocked(db.review.create).mockResolvedValue({
        id: "review-1",
      } as never);

      await reviewService.createReview(
        { orderId: "order-1", rating: 3, comment: "OK" },
        "buyer-1",
      );

      expect(db.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rating: 30 }),
        }),
      );
    });
  });

  // ── replyToReview ─────────────────────────────────────────────────────────

  describe("replyToReview", () => {
    const mockReview = {
      id: "review-1",
      sellerId: "seller-1",
      sellerReply: null,
    };

    it("allows seller to reply to their review", async () => {
      vi.mocked(db.review.findUnique).mockResolvedValue(mockReview as never);
      vi.mocked(db.review.update).mockResolvedValue({} as never);

      await reviewService.replyToReview(
        { reviewId: "review-1", reply: "Thanks for your review!" },
        "seller-1",
      );

      expect(db.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sellerReply: "Thanks for your review!",
          }),
        }),
      );
    });

    it("rejects reply from wrong seller", async () => {
      vi.mocked(db.review.findUnique).mockResolvedValue(mockReview as never);

      await expect(
        reviewService.replyToReview(
          { reviewId: "review-1", reply: "Thanks!" },
          "wrong-seller",
        ),
      ).rejects.toThrow("own listings");
    });

    it("rejects if review not found", async () => {
      vi.mocked(db.review.findUnique).mockResolvedValue(null);

      await expect(
        reviewService.replyToReview(
          { reviewId: "nope", reply: "Thanks!" },
          "seller-1",
        ),
      ).rejects.toThrow(AppError);
    });

    it("rejects duplicate reply", async () => {
      vi.mocked(db.review.findUnique).mockResolvedValue({
        ...mockReview,
        sellerReply: "Already replied",
      } as never);

      await expect(
        reviewService.replyToReview(
          { reviewId: "review-1", reply: "Second reply" },
          "seller-1",
        ),
      ).rejects.toThrow("already replied");
    });
  });

  // ── fetchSellerReviews ────────────────────────────────────────────────────

  describe("fetchSellerReviews", () => {
    it("returns mapped seller reviews", async () => {
      vi.mocked(db.review.findMany).mockResolvedValue([
        {
          id: "review-1",
          rating: 45,
          comment: "Great!",
          sellerReply: null,
          createdAt: new Date("2026-01-15"),
          author: { displayName: "Buyer One" },
          order: { listing: { title: "iPhone 15" } },
        },
      ] as never);

      const result = await reviewService.fetchSellerReviews("seller-1");

      expect(result).toHaveLength(1);
      expect(result[0]?.rating).toBe(5); // 45 / 10 rounded
      expect(result[0]?.buyerName).toBe("Buyer One");
      expect(result[0]?.listingTitle).toBe("iPhone 15");
    });

    it("returns empty array when no reviews", async () => {
      vi.mocked(db.review.findMany).mockResolvedValue([]);

      const result = await reviewService.fetchSellerReviews("seller-1");

      expect(result).toEqual([]);
    });
  });
});
