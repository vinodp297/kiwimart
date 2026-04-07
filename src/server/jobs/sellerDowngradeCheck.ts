// src/server/jobs/sellerDowngradeCheck.ts
// ─── Automated Seller Tier Downgrade ────────────────────────────────────────
// Runs daily via cron. Checks sellers whose dispute rate or open dispute
// count exceeds configurable thresholds and downgrades their performance
// tier by one level (GOLD→SILVER, SILVER→BRONZE).

import db from "@/lib/db";
import {
  CONFIG_KEYS,
  getConfigFloat,
  getConfigInt,
} from "@/lib/platform-config";
import { calculateSellerTier } from "@/lib/seller-tiers.server";
import type { PerformanceTier } from "@/lib/seller-tiers";
import { audit } from "@/server/lib/audit";
import { createNotification } from "@/modules/notifications/notification.service";
import { logger } from "@/shared/logger";

function downgradeOneTier(tier: PerformanceTier): PerformanceTier {
  if (tier === "GOLD") return "SILVER";
  if (tier === "SILVER") return "BRONZE";
  return null; // Already at floor or no tier — cannot downgrade
}

export async function runSellerDowngradeCheck(): Promise<{
  checked: number;
  downgraded: number;
}> {
  const [disputeRateThresholdPct, openDisputeThreshold] = await Promise.all([
    getConfigFloat(CONFIG_KEYS.SELLER_DOWNGRADE_DISPUTE_RATE_PCT),
    getConfigInt(CONFIG_KEYS.SELLER_DOWNGRADE_OPEN_DISPUTES),
  ]);
  const disputeRateThreshold = disputeRateThresholdPct / 100;

  // Fetch both seller risk groups in parallel (independent queries with different filters)
  const [sellersAtRisk, sellersWithOpenDisputes] = await Promise.all([
    // Sellers with trust metrics exceeding dispute rate threshold
    db.user.findMany({
      where: {
        isSellerEnabled: true,
        isBanned: false,
        sellerTierOverride: null,
        trustMetrics: {
          disputeRate: { gt: disputeRateThreshold },
        },
      },
      select: {
        id: true,
        trustMetrics: {
          select: {
            completedOrders: true,
            totalOrders: true,
            averageRating: true,
            disputeRate: true,
          },
        },
      },
    }),
    // Sellers with too many simultaneously open disputes
    db.user.findMany({
      where: {
        isSellerEnabled: true,
        isBanned: false,
        sellerTierOverride: null,
        sellerOrders: {
          some: { status: "DISPUTED" },
        },
      },
      select: {
        id: true,
        trustMetrics: {
          select: {
            completedOrders: true,
            totalOrders: true,
            averageRating: true,
            disputeRate: true,
          },
        },
        _count: {
          select: {
            sellerOrders: { where: { status: "DISPUTED" } },
          },
        },
      },
    }),
  ]);

  // Merge both sets into a unique map
  const candidateMap = new Map<
    string,
    {
      id: string;
      completedOrders: number;
      avgRating: number;
      completionRate: number;
      disputeRate: number;
      openDisputeCount: number;
    }
  >();

  for (const s of sellersAtRisk) {
    if (!s.trustMetrics) continue;
    const completionRate =
      s.trustMetrics.totalOrders > 0
        ? (s.trustMetrics.completedOrders / s.trustMetrics.totalOrders) * 100
        : 0;
    candidateMap.set(s.id, {
      id: s.id,
      completedOrders: s.trustMetrics.completedOrders,
      avgRating: s.trustMetrics.averageRating ?? 0,
      completionRate,
      disputeRate: s.trustMetrics.disputeRate,
      openDisputeCount: 0,
    });
  }

  for (const s of sellersWithOpenDisputes) {
    const openCount = s._count.sellerOrders;
    if (openCount <= openDisputeThreshold) continue;
    const existing = candidateMap.get(s.id);
    if (existing) {
      existing.openDisputeCount = openCount;
    } else if (s.trustMetrics) {
      const completionRate =
        s.trustMetrics.totalOrders > 0
          ? (s.trustMetrics.completedOrders / s.trustMetrics.totalOrders) * 100
          : 0;
      candidateMap.set(s.id, {
        id: s.id,
        completedOrders: s.trustMetrics.completedOrders,
        avgRating: s.trustMetrics.averageRating ?? 0,
        completionRate,
        disputeRate: s.trustMetrics.disputeRate,
        openDisputeCount: openCount,
      });
    }
  }

  let downgraded = 0;
  const checked = candidateMap.size;

  for (const seller of candidateMap.values()) {
    try {
      const currentTier = await calculateSellerTier({
        completedSales: seller.completedOrders,
        avgRating: seller.avgRating,
        completionRate: seller.completionRate,
      });

      const downgradedTier = downgradeOneTier(currentTier);
      if (!downgradedTier) continue; // Already at floor

      const reason =
        seller.disputeRate > disputeRateThreshold
          ? `Automatic downgrade: dispute rate ${(seller.disputeRate * 100).toFixed(1)}% exceeded ${disputeRateThresholdPct}% threshold`
          : `Automatic downgrade: ${seller.openDisputeCount} simultaneously open disputes exceeded ${openDisputeThreshold} threshold`;

      await db.user.update({
        where: { id: seller.id },
        data: {
          sellerTierOverride: downgradedTier,
          sellerTierOverrideReason: reason,
          sellerTierOverrideAt: new Date(),
          sellerTierOverrideBy: "SYSTEM",
        },
      });

      createNotification({
        userId: seller.id,
        type: "SYSTEM",
        title: "Your seller status has been updated",
        body: "Your seller tier has been adjusted due to a high dispute rate. Resolve your open disputes to restore your previous status. Contact support if you believe this is an error.",
        link: "/dashboard/seller",
      }).catch(() => {});

      audit({
        userId: null,
        action: "SELLER_TIER_DOWNGRADED",
        entityType: "User",
        entityId: seller.id,
        metadata: {
          previousTier: currentTier,
          newTier: downgradedTier,
          disputeRate: seller.disputeRate,
          openDisputeCount: seller.openDisputeCount,
          triggeredBy: "SYSTEM",
        },
      });

      downgraded++;
    } catch (err) {
      logger.error("seller.downgrade.individual_failed", {
        sellerId: seller.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("seller.downgrade.check.complete", { checked, downgraded });
  return { checked, downgraded };
}
