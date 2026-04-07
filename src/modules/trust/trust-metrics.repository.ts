// src/modules/trust/trust-metrics.repository.ts
// ─── Trust Metrics Repository — data access only, no business logic ──────────
// All DB queries used by trust-metrics.service.ts.

import db from "@/lib/db";

export const trustMetricsRepository = {
  // ── Cache lookup ───────────────────────────────────────────────────────────

  /** Fetch cached trust metrics for a user (if they exist).
   * @source src/modules/trust/trust-metrics.service.ts — getMetrics */
  async findCached(userId: string) {
    return db.trustMetrics.findUnique({ where: { userId } });
  },

  // ── User helpers ───────────────────────────────────────────────────────────

  /** Fetch a user's account creation date (for age calculation).
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async findCreatedAt(userId: string): Promise<{ createdAt: Date } | null> {
    return db.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
  },

  /** Fetch all active, non-deleted users for batch recomputation.
   * @source src/modules/trust/trust-metrics.service.ts — computeAllMetrics */
  async findAllActiveUserIds(): Promise<{ id: string }[]> {
    return db.user.findMany({
      where: { isBanned: false, deletedAt: null },
      select: { id: true },
      take: 1000,
    });
  },

  // ── Order counts ───────────────────────────────────────────────────────────

  /** Count total orders where the user is the buyer.
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async countBuyerOrders(userId: string): Promise<number> {
    return db.order.count({ where: { buyerId: userId } });
  },

  /** Count total orders where the user is the seller.
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async countSellerOrders(userId: string): Promise<number> {
    return db.order.count({ where: { sellerId: userId } });
  },

  /** Count completed orders where the user is the buyer.
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async countCompletedBuyerOrders(userId: string): Promise<number> {
    return db.order.count({ where: { buyerId: userId, status: "COMPLETED" } });
  },

  /** Count completed orders where the user is the seller.
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async countCompletedSellerOrders(userId: string): Promise<number> {
    return db.order.count({ where: { sellerId: userId, status: "COMPLETED" } });
  },

  /** Count orders with disputes where the user is the buyer.
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async countBuyerDisputes(userId: string): Promise<number> {
    return db.order.count({
      where: { buyerId: userId, dispute: { isNot: null } },
    });
  },

  /** Count orders with disputes where the user is the seller.
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async countSellerDisputes(userId: string): Promise<number> {
    return db.order.count({
      where: { sellerId: userId, dispute: { isNot: null } },
    });
  },

  /** Count recent disputed buyer orders within the rolling window.
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async countRecentBuyerDisputes(userId: string, since: Date): Promise<number> {
    return db.order.count({
      where: {
        buyerId: userId,
        dispute: { openedAt: { gte: since } },
      },
    });
  },

  /** Count recent disputed seller orders within the rolling window.
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async countRecentSellerDisputes(
    userId: string,
    since: Date,
  ): Promise<number> {
    return db.order.count({
      where: {
        sellerId: userId,
        dispute: { openedAt: { gte: since } },
      },
    });
  },

  // ── Review helpers ─────────────────────────────────────────────────────────

  /** Fetch approved buyer review ratings for a user (for average rating calc).
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async findApprovedReviewRatings(
    userId: string,
  ): Promise<{ rating: number }[]> {
    return db.review.findMany({
      where: { subjectId: userId, reviewerRole: "BUYER", isApproved: true },
      select: { rating: true },
    });
  },

  // ── Dispatch photo helpers ─────────────────────────────────────────────────

  /** Count dispatched orders (for dispatch photo rate calculation).
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async countDispatchedSellerOrders(userId: string): Promise<number> {
    return db.order.count({
      where: { sellerId: userId, dispatchedAt: { not: null } },
    });
  },

  /** Count dispatch events that include photos (for dispatch photo rate).
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async countDispatchedWithPhotos(userId: string): Promise<number> {
    return db.orderEvent.count({
      where: {
        type: "DISPATCHED",
        order: { sellerId: userId },
        metadata: { path: ["dispatchPhotos"], not: { equals: null } },
      },
    });
  },

  // ── Dispute response helpers ───────────────────────────────────────────────

  /** Fetch responded disputes for a seller (for average response time calc).
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async findRespondedDisputes(
    userId: string,
  ): Promise<{ openedAt: Date; sellerRespondedAt: Date | null }[]> {
    return db.dispute.findMany({
      where: {
        order: { sellerId: userId },
        sellerRespondedAt: { not: null },
      },
      select: { openedAt: true, sellerRespondedAt: true },
    });
  },

  // ── Upsert ─────────────────────────────────────────────────────────────────

  /** Upsert computed trust metrics into the cache table.
   * @source src/modules/trust/trust-metrics.service.ts — computeMetrics */
  async upsertMetrics(
    userId: string,
    metrics: {
      totalOrders: number;
      completedOrders: number;
      disputeCount: number;
      disputeRate: number;
      disputesLast30Days: number;
      averageResponseHours: number | null;
      averageRating: number | null;
      dispatchPhotoRate: number;
      accountAgeDays: number;
      isFlaggedForFraud: boolean;
      lastComputedAt: Date;
    },
  ): Promise<void> {
    await db.trustMetrics.upsert({
      where: { userId },
      create: { userId, ...metrics },
      update: metrics,
    });
  },
};
