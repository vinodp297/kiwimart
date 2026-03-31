// src/modules/trust/trust-metrics.service.ts
// ─── Trust Metrics Service (Cached) ────────────────────────────────────────
// Computes and caches buyer/seller trust metrics in the TrustMetrics table.
// Metrics are recomputed when stale (>24h) or on-demand.
// Used by the auto-resolution engine and admin dispute panels.

import db from "@/lib/db";
import { logger } from "@/shared/logger";

// ── Types ─────────────────────────────────────────────────────────────────

export interface BuyerMetrics {
  totalOrders: number;
  completedOrders: number;
  disputeCount: number;
  disputeRate: number;
  disputesLast30Days: number;
  accountAge: number;
  isFlaggedForFraud: boolean;
}

export interface SellerMetrics {
  totalOrders: number;
  completedOrders: number;
  disputeCount: number;
  disputeRate: number;
  averageResponseTime: number | null;
  averageRating: number | null;
  dispatchPhotosRate: number;
  accountAge: number;
  isFlaggedForFraud: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Service ───────────────────────────────────────────────────────────────

export class TrustMetricsService {
  /**
   * Get cached metrics, recomputing if stale (>24h).
   */
  async getMetrics(userId: string): Promise<{
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
  }> {
    const cached = await db.trustMetrics.findUnique({
      where: { userId },
    });

    if (cached && Date.now() - cached.lastComputedAt.getTime() < CACHE_TTL_MS) {
      return {
        totalOrders: cached.totalOrders,
        completedOrders: cached.completedOrders,
        disputeCount: cached.disputeCount,
        disputeRate: cached.disputeRate,
        disputesLast30Days: cached.disputesLast30Days,
        averageResponseHours: cached.averageResponseHours,
        averageRating: cached.averageRating,
        dispatchPhotoRate: cached.dispatchPhotoRate,
        accountAgeDays: cached.accountAgeDays,
        isFlaggedForFraud: cached.isFlaggedForFraud,
      };
    }

    return this.computeMetrics(userId);
  }

  /**
   * Compute all metrics for a user and upsert into the TrustMetrics table.
   */
  async computeMetrics(userId: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      user,
      totalBuyerOrders,
      totalSellerOrders,
      completedBuyer,
      completedSeller,
      disputesBuyer,
      disputesSeller,
      disputesLast30Buyer,
      disputesLast30Seller,
      reviews,
      dispatchedOrders,
      dispatchedWithPhotos,
    ] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: { createdAt: true },
      }),
      db.order.count({ where: { buyerId: userId } }),
      db.order.count({ where: { sellerId: userId } }),
      db.order.count({ where: { buyerId: userId, status: "COMPLETED" } }),
      db.order.count({ where: { sellerId: userId, status: "COMPLETED" } }),
      db.order.count({
        where: { buyerId: userId, disputeOpenedAt: { not: null } },
      }),
      db.order.count({
        where: { sellerId: userId, disputeOpenedAt: { not: null } },
      }),
      db.order.count({
        where: {
          buyerId: userId,
          disputeOpenedAt: { not: null, gte: thirtyDaysAgo },
        },
      }),
      db.order.count({
        where: {
          sellerId: userId,
          disputeOpenedAt: { not: null, gte: thirtyDaysAgo },
        },
      }),
      db.review.findMany({
        where: { sellerId: userId, approved: true },
        select: { rating: true },
      }),
      db.order.count({
        where: { sellerId: userId, dispatchedAt: { not: null } },
      }),
      db.orderEvent.count({
        where: {
          type: "DISPATCHED",
          order: { sellerId: userId },
          metadata: { path: ["dispatchPhotos"], not: { equals: null } },
        },
      }),
    ]);

    const totalOrders = totalBuyerOrders + totalSellerOrders;
    const completedOrders = completedBuyer + completedSeller;
    const disputeCount = disputesBuyer + disputesSeller;
    const disputesLast30Days = disputesLast30Buyer + disputesLast30Seller;
    const disputeRate =
      totalOrders > 0
        ? Math.round((disputeCount / totalOrders) * 1000) / 10
        : 0;

    const accountAgeDays = user
      ? Math.floor(
          (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;

    // Average rating (stored as 1-50, represents 0.1-5.0)
    const averageRating =
      reviews.length > 0
        ? Math.round(
            (reviews.reduce((sum, r) => sum + r.rating, 0) /
              reviews.length /
              10) *
              10,
          ) / 10
        : null;

    // Average response time to disputes
    const respondedDisputes = await db.order.findMany({
      where: {
        sellerId: userId,
        disputeOpenedAt: { not: null },
        sellerRespondedAt: { not: null },
      },
      select: { disputeOpenedAt: true, sellerRespondedAt: true },
    });

    let averageResponseHours: number | null = null;
    if (respondedDisputes.length > 0) {
      const totalHours = respondedDisputes.reduce((sum, d) => {
        return (
          sum +
          (d.sellerRespondedAt!.getTime() - d.disputeOpenedAt!.getTime()) /
            (1000 * 60 * 60)
        );
      }, 0);
      averageResponseHours =
        Math.round((totalHours / respondedDisputes.length) * 10) / 10;
    }

    const dispatchPhotoRate =
      dispatchedOrders > 0
        ? Math.round((dispatchedWithPhotos / dispatchedOrders) * 1000) / 10
        : 0;

    // Fraud flags
    const isFlaggedForFraud =
      disputesLast30Days >= 5 || (totalOrders >= 5 && disputeRate > 20);

    if (isFlaggedForFraud) {
      logger.warn("trust.fraud_flagged", {
        userId,
        disputesLast30Days,
        disputeRate,
      });
    }

    // Upsert into DB
    const metrics = {
      totalOrders,
      completedOrders,
      disputeCount,
      disputeRate,
      disputesLast30Days,
      averageResponseHours,
      averageRating,
      dispatchPhotoRate,
      accountAgeDays,
      isFlaggedForFraud,
      lastComputedAt: new Date(),
    };

    await db.trustMetrics.upsert({
      where: { userId },
      create: { userId, ...metrics },
      update: metrics,
    });

    logger.info("trust.metrics.computed", { userId, totalOrders, disputeRate });

    return metrics;
  }

  /**
   * Batch recompute all users (for scheduled job).
   */
  async computeAllMetrics(): Promise<{ computed: number; errors: number }> {
    let computed = 0;
    let errors = 0;

    const users = await db.user.findMany({
      where: { isBanned: false, deletedAt: null },
      select: { id: true },
      take: 1000,
    });

    for (const user of users) {
      try {
        await this.computeMetrics(user.id);
        computed++;
      } catch (err) {
        errors++;
        logger.error("trust.metrics.batch_failed", {
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("trust.metrics.batch_complete", { computed, errors });
    return { computed, errors };
  }

  // ── Convenience methods for specific roles ─────────────────────

  async getBuyerMetrics(userId: string): Promise<BuyerMetrics> {
    const m = await this.getMetrics(userId);
    return {
      totalOrders: m.totalOrders,
      completedOrders: m.completedOrders,
      disputeCount: m.disputeCount,
      disputeRate: m.disputeRate,
      disputesLast30Days: m.disputesLast30Days,
      accountAge: m.accountAgeDays,
      isFlaggedForFraud: m.isFlaggedForFraud,
    };
  }

  async getSellerMetrics(userId: string): Promise<SellerMetrics> {
    const m = await this.getMetrics(userId);
    return {
      totalOrders: m.totalOrders,
      completedOrders: m.completedOrders,
      disputeCount: m.disputeCount,
      disputeRate: m.disputeRate,
      averageResponseTime: m.averageResponseHours,
      averageRating: m.averageRating,
      dispatchPhotosRate: m.dispatchPhotoRate,
      accountAge: m.accountAgeDays,
      isFlaggedForFraud: m.isFlaggedForFraud,
    };
  }
}

export const trustMetricsService = new TrustMetricsService();
