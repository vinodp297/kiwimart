// src/modules/trust/trust-metrics.service.ts
// ─── Trust Metrics Service (Cached) ────────────────────────────────────────
// Computes and caches buyer/seller trust metrics in the TrustMetrics table.
// Metrics are recomputed when stale (>24h) or on-demand.
// Used by the auto-resolution engine and admin dispute panels.

import { trustMetricsRepository } from "./trust-metrics.repository";
import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { logger } from "@/shared/logger";
import { MS_PER_HOUR, MS_PER_DAY } from "@/lib/time";

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

// CACHE_TTL — now read from PlatformConfig inside getMetrics

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
    const cacheHours = await getConfigInt(
      CONFIG_KEYS.TRUST_METRICS_CACHE_HOURS,
    );
    const CACHE_TTL_MS = cacheHours * MS_PER_HOUR;

    const cached = await trustMetricsRepository.findCached(userId);

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
    const rollingDays = await getConfigInt(
      CONFIG_KEYS.TRUST_SCORE_ROLLING_DAYS,
    );
    const rollingWindowAgo = new Date(Date.now() - rollingDays * MS_PER_DAY);

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
      trustMetricsRepository.findCreatedAt(userId),
      trustMetricsRepository.countBuyerOrders(userId),
      trustMetricsRepository.countSellerOrders(userId),
      trustMetricsRepository.countCompletedBuyerOrders(userId),
      trustMetricsRepository.countCompletedSellerOrders(userId),
      trustMetricsRepository.countBuyerDisputes(userId),
      trustMetricsRepository.countSellerDisputes(userId),
      trustMetricsRepository.countRecentBuyerDisputes(userId, rollingWindowAgo),
      trustMetricsRepository.countRecentSellerDisputes(
        userId,
        rollingWindowAgo,
      ),
      trustMetricsRepository.findApprovedReviewRatings(userId),
      trustMetricsRepository.countDispatchedSellerOrders(userId),
      trustMetricsRepository.countDispatchedWithPhotos(userId),
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
      ? Math.floor((Date.now() - user.createdAt.getTime()) / MS_PER_DAY)
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

    // Average response time to disputes (from Dispute model)
    const respondedDisputes =
      await trustMetricsRepository.findRespondedDisputes(userId);

    let averageResponseHours: number | null = null;
    if (respondedDisputes.length > 0) {
      const totalHours = respondedDisputes.reduce((sum, d) => {
        return (
          sum +
          (d.sellerRespondedAt!.getTime() - d.openedAt.getTime()) / MS_PER_HOUR
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

    await trustMetricsRepository.upsertMetrics(userId, metrics);

    logger.info("trust.metrics.computed", { userId, totalOrders, disputeRate });

    return metrics;
  }

  /**
   * Batch recompute all users (for scheduled job).
   */
  async computeAllMetrics(): Promise<{ computed: number; errors: number }> {
    let computed = 0;
    let errors = 0;

    const users = await trustMetricsRepository.findAllActiveUserIds();

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
