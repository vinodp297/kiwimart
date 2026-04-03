// src/modules/sellers/trust-score.service.ts
// ─── Seller Trust Score — computed, cached 1hr ─────────────────────────────

import db from "@/lib/db";
import { unstable_cache } from "next/cache";

export interface TrustScoreData {
  score: number; // 0–100
  avgRating: number; // 0–5
  reviewCount: number;
  completionRate: number; // 0–100
  responseRate: number; // 0–100
  verifiedSeller: boolean;
  memberMonths: number;
  disputeRate: number; // 0–1
}

function calculateTrustScore(data: TrustScoreData): number {
  let score = 0;
  // Rating component (35 points max)
  score += (data.avgRating / 5) * 35;
  // Review volume (10 points max — logarithmic)
  score += Math.min(10, Math.log10(data.reviewCount + 1) * 10);
  // Completion rate (20 points max)
  score += (data.completionRate / 100) * 20;
  // Response rate (15 points max)
  score += (data.responseRate / 100) * 15;
  // Verified seller bonus (10 points)
  if (data.verifiedSeller) score += 10;
  // Tenure bonus (5 points max)
  score += Math.min(5, data.memberMonths / 12);
  // Dispute penalty (subtract up to 15 points)
  score -= Math.min(15, data.disputeRate * 100);
  return Math.round(Math.max(0, Math.min(100, score)));
}

import { calculateSellerTier } from "@/lib/seller-tiers.server";
import type { PerformanceTier } from "@/lib/seller-tiers";
export { calculateSellerTier };
export type { PerformanceTier };

export interface SellerTrustProfile {
  trustScore: number;
  tier: PerformanceTier;
  data: TrustScoreData;
  completedSales: number;
  totalOrders: number;
}

async function fetchSellerTrustProfile(
  sellerId: string,
): Promise<SellerTrustProfile> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const [user, orderStats, reviewStats, recentCompletedSales] =
    await Promise.all([
      db.user.findUnique({
        where: { id: sellerId },
        select: {
          createdAt: true,
          isVerifiedSeller: true,
          idVerified: true,
          responseRate: true,
          sellerTierOverride: true,
        },
      }),
      db.order.groupBy({
        by: ["status"],
        where: { sellerId },
        _count: { id: true },
      }),
      db.review.aggregate({
        where: { sellerId, approved: true },
        _avg: { rating: true },
        _count: { id: true },
      }),
      // Tier calculation uses only recent sales (last 12 months)
      db.order.count({
        where: {
          sellerId,
          status: "COMPLETED",
          completedAt: { gte: twelveMonthsAgo },
        },
      }),
    ]);

  if (!user) {
    return {
      trustScore: 0,
      tier: null,
      data: {
        score: 0,
        avgRating: 0,
        reviewCount: 0,
        completionRate: 0,
        responseRate: 0,
        verifiedSeller: false,
        memberMonths: 0,
        disputeRate: 0,
      },
      completedSales: 0,
      totalOrders: 0,
    };
  }

  const statusCounts: Record<string, number> = {};
  for (const row of orderStats) {
    statusCounts[row.status] = row._count.id;
  }

  const completedOrders = statusCounts["COMPLETED"] ?? 0;
  const disputedOrders = statusCounts["DISPUTED"] ?? 0;
  const totalOrders = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const completionRate =
    totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 100;
  const disputeRate = totalOrders > 0 ? disputedOrders / totalOrders : 0;

  // Rating stored as 1-50 in DB, convert to 0-5
  const avgRating = reviewStats._avg.rating ? reviewStats._avg.rating / 10 : 0;
  const reviewCount = reviewStats._count.id;

  const memberMonths = Math.floor(
    (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30),
  );

  const data: TrustScoreData = {
    score: 0,
    avgRating,
    reviewCount,
    completionRate,
    responseRate: user.responseRate ?? 0,
    verifiedSeller: user.isVerifiedSeller || user.idVerified,
    memberMonths,
    disputeRate,
  };

  data.score = calculateTrustScore(data);

  // Tier uses recent sales (last 12 months) — sellers must stay active to keep tier
  // Pass sellerTierOverride so admin-set overrides take precedence
  const tier = await calculateSellerTier(
    {
      completedSales: recentCompletedSales,
      avgRating,
      completionRate,
    },
    user.sellerTierOverride,
  );

  return {
    trustScore: data.score,
    tier,
    data,
    completedSales: completedOrders,
    totalOrders,
  };
}

/**
 * Get a seller's trust profile (trust score + tier). Cached for 1 hour.
 */
export const getSellerTrustProfile = unstable_cache(
  fetchSellerTrustProfile,
  ["seller-trust-profile"],
  { revalidate: 3600 },
);
