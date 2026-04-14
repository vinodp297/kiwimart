// src/test/reviews.actions.test.ts
// ─── Tests: reviews.ts (createReview, replyToReview) ─────────────────────────
//
// This file covers the server-action thin layer over reviewService.
// It validates:
//   A  Auth guard — requireUser throwing → action surfaces error
//   B  Schema validation — invalid input → { success: false } before service call
//   C  Happy paths — valid input → delegates to reviewService, returns success
//   D  Error handling — service throwing → action surfaces safe error

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn().mockResolvedValue({
  id: "user_buyer",
  email: "buyer@test.com",
  isAdmin: false,
});
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock reviewService ────────────────────────────────────────────────────────
const mockCreateReview = vi.fn().mockResolvedValue({
  reviewId: "review_abc123",
  subjectId: "seller_xyz",
});
const mockReplyToReview = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/reviews/review.service", () => ({
  reviewService: {
    createReview: (...args: unknown[]) => mockCreateReview(...args),
    replyToReview: (...args: unknown[]) => mockReplyToReview(...args),
  },
}));

// ── Lazy import after mocks ───────────────────────────────────────────────────
const { createReview, replyToReview } =
  await import("@/server/actions/reviews");

// ── Valid input fixtures ──────────────────────────────────────────────────────
const VALID_CREATE_REVIEW = {
  orderId: "order_001",
  rating: 5,
  comment: "Great seller, fast shipping!",
  tags: ["FAST_SHIPPING"] as const,
  reviewerRole: "BUYER" as const,
};

const VALID_REPLY = {
  reviewId: "review_abc123",
  reply: "Thank you for your kind words!",
};

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A — Auth guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth guard — both actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
  });

  it("createReview — unauthenticated → returns auth error without calling service", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await createReview(VALID_CREATE_REVIEW);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateReview).not.toHaveBeenCalled();
  });

  it("replyToReview — unauthenticated → returns auth error without calling service", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await replyToReview(VALID_REPLY);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockReplyToReview).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B — Schema validation
// ─────────────────────────────────────────────────────────────────────────────

describe("createReview — schema validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
  });

  it("missing orderId → returns validation error with fieldErrors", async () => {
    const result = await createReview({ ...VALID_CREATE_REVIEW, orderId: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
      expect(result.fieldErrors).toBeDefined();
    }
    expect(mockCreateReview).not.toHaveBeenCalled();
  });

  it("rating below 1 → returns validation error", async () => {
    const result = await createReview({ ...VALID_CREATE_REVIEW, rating: 0 });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateReview).not.toHaveBeenCalled();
  });

  it("rating above 5 → returns validation error", async () => {
    const result = await createReview({ ...VALID_CREATE_REVIEW, rating: 6 });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateReview).not.toHaveBeenCalled();
  });

  it("comment shorter than 10 chars → returns validation error", async () => {
    const result = await createReview({
      ...VALID_CREATE_REVIEW,
      comment: "Too short",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateReview).not.toHaveBeenCalled();
  });

  it("comment exceeds 1000 chars → returns validation error", async () => {
    const result = await createReview({
      ...VALID_CREATE_REVIEW,
      comment: "x".repeat(1001),
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateReview).not.toHaveBeenCalled();
  });

  it("more than 6 tags → returns validation error", async () => {
    const result = await createReview({
      ...VALID_CREATE_REVIEW,
      tags: [
        "FAST_SHIPPING",
        "GREAT_PACKAGING",
        "ACCURATE_DESCRIPTION",
        "QUICK_COMMUNICATION",
        "FAIR_PRICING",
        "AS_DESCRIBED",
        "FAST_SHIPPING",
      ] as unknown as [],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateReview).not.toHaveBeenCalled();
  });

  it("non-object payload → returns validation error", async () => {
    const result = await createReview(null);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateReview).not.toHaveBeenCalled();
  });
});

describe("replyToReview — schema validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
    });
  });

  it("missing reviewId → returns validation error without calling service", async () => {
    const result = await replyToReview({ ...VALID_REPLY, reviewId: "" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockReplyToReview).not.toHaveBeenCalled();
  });

  it("empty reply → returns validation error", async () => {
    const result = await replyToReview({ ...VALID_REPLY, reply: "" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockReplyToReview).not.toHaveBeenCalled();
  });

  it("reply exceeds 500 chars → returns validation error", async () => {
    const result = await replyToReview({
      ...VALID_REPLY,
      reply: "x".repeat(501),
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockReplyToReview).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C — Happy paths
// ─────────────────────────────────────────────────────────────────────────────

describe("createReview — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
    mockCreateReview.mockResolvedValue({
      reviewId: "review_abc123",
      subjectId: "seller_xyz",
    });
  });

  it("valid BUYER review → delegates to reviewService.createReview and returns reviewId", async () => {
    const result = await createReview(VALID_CREATE_REVIEW);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reviewId).toBe("review_abc123");
    expect(mockCreateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_001",
        rating: 5,
        reviewerRole: "BUYER",
      }),
      "user_buyer",
    );
  });

  it("SELLER role review → correct reviewerRole forwarded to service", async () => {
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
    });

    const result = await createReview({
      ...VALID_CREATE_REVIEW,
      reviewerRole: "SELLER",
    });

    expect(result.success).toBe(true);
    expect(mockCreateReview).toHaveBeenCalledWith(
      expect.objectContaining({ reviewerRole: "SELLER" }),
      "user_seller",
    );
  });

  it("tags array is passed through to service", async () => {
    const result = await createReview({
      ...VALID_CREATE_REVIEW,
      tags: ["FAST_SHIPPING", "GREAT_PACKAGING"] as unknown as [],
    });

    expect(result.success).toBe(true);
    expect(mockCreateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining(["FAST_SHIPPING", "GREAT_PACKAGING"]),
      }),
      "user_buyer",
    );
  });

  it("no tags provided → defaults to empty array, service still called", async () => {
    const result = await createReview({
      orderId: "order_001",
      rating: 4,
      comment: "Solid transaction overall.",
    });

    expect(result.success).toBe(true);
    expect(mockCreateReview).toHaveBeenCalledOnce();
  });
});

describe("replyToReview — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
    });
    mockReplyToReview.mockResolvedValue(undefined);
  });

  it("valid reply → delegates to reviewService.replyToReview with userId", async () => {
    const result = await replyToReview(VALID_REPLY);

    expect(result.success).toBe(true);
    expect(mockReplyToReview).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: "review_abc123",
        reply: "Thank you for your kind words!",
      }),
      "user_seller",
    );
  });

  it("return value is { success: true, data: undefined }", async () => {
    const result = await replyToReview(VALID_REPLY);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP D — Error handling
// ─────────────────────────────────────────────────────────────────────────────

describe("createReview — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
  });

  it("service throws AppError (order not completed) → action surfaces error", async () => {
    mockCreateReview.mockRejectedValueOnce(
      Object.assign(
        new Error("You can only leave a review after the order is completed."),
        { code: "ORDER_WRONG_STATE" },
      ),
    );

    const result = await createReview(VALID_CREATE_REVIEW);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("service throws AppError (order not found) → action surfaces error", async () => {
    mockCreateReview.mockRejectedValueOnce(
      Object.assign(new Error("Order not found"), {
        code: "NOT_FOUND",
        statusCode: 404,
      }),
    );

    const result = await createReview(VALID_CREATE_REVIEW);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("service throws generic error → action returns safe fallback message", async () => {
    mockCreateReview.mockRejectedValueOnce(new Error("Database timeout"));

    const result = await createReview(VALID_CREATE_REVIEW);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("never throws — always returns ActionResult shape", async () => {
    mockCreateReview.mockRejectedValueOnce(new Error("Unexpected crash"));

    const result = await createReview(VALID_CREATE_REVIEW);

    expect(result).toHaveProperty("success", false);
    expect(() => result).not.toThrow();
  });
});

describe("replyToReview — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
    });
  });

  it("service throws AppError (review not found) → action surfaces error", async () => {
    mockReplyToReview.mockRejectedValueOnce(
      Object.assign(new Error("Review not found"), {
        code: "NOT_FOUND",
        statusCode: 404,
      }),
    );

    const result = await replyToReview(VALID_REPLY);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("service throws generic error → action returns safe fallback message", async () => {
    mockReplyToReview.mockRejectedValueOnce(new Error("Connection reset"));

    const result = await replyToReview(VALID_REPLY);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("never throws — always returns ActionResult shape", async () => {
    mockReplyToReview.mockRejectedValueOnce(new Error("Unexpected crash"));

    const result = await replyToReview(VALID_REPLY);

    expect(result).toHaveProperty("success", false);
    expect(() => result).not.toThrow();
  });
});
