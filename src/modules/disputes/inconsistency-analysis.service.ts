// src/modules/disputes/inconsistency-analysis.service.ts
// ─── Lie Detection / Inconsistency Analysis ──────────────────────────────
// Scans dispute evidence for contradictions and red flags.
// Returns an array of alerts the admin can use to guide their decision.

import db from "@/lib/db";
import { trustMetricsService } from "@/modules/trust/trust-metrics.service";

// ── Types ─────────────────────────────────────────────────────────────────

export interface InconsistencyAlert {
  type: "warning" | "alert";
  message: string;
  severity: "low" | "medium" | "high";
}

// ── Analysis ──────────────────────────────────────────────────────────────

export async function analyzeInconsistencies(
  orderId: string,
): Promise<InconsistencyAlert[]> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      trackingNumber: true,
      dispatchedAt: true,
      completedAt: true,
      disputeReason: true,
      disputeNotes: true,
      disputeOpenedAt: true,
      disputeEvidenceUrls: true,
      sellerResponse: true,
      sellerRespondedAt: true,
      listing: {
        select: {
          title: true,
          condition: true,
          description: true,
        },
      },
    },
  });

  if (!order) return [];

  const alerts: InconsistencyAlert[] = [];

  // Fetch events and metrics in parallel
  const [
    deliveryOkEvent,
    dispatchEvent,
    buyerMetrics,
    sellerMetrics,
    recentBuyerDisputes,
  ] = await Promise.all([
    db.orderEvent.findFirst({
      where: { orderId, type: "DELIVERY_CONFIRMED_OK" },
      select: { createdAt: true, metadata: true },
    }),
    db.orderEvent.findFirst({
      where: { orderId, type: "DISPATCHED" },
      select: { metadata: true },
    }),
    trustMetricsService.getMetrics(order.buyerId),
    trustMetricsService.getMetrics(order.sellerId),
    db.order.count({
      where: {
        buyerId: order.buyerId,
        disputeOpenedAt: {
          not: null,
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  const dispatchMeta = (dispatchEvent?.metadata ?? {}) as Record<
    string,
    unknown
  >;
  const hasDispatchPhotos =
    Array.isArray(dispatchMeta.dispatchPhotos) &&
    dispatchMeta.dispatchPhotos.length > 0;

  // 1. Buyer confirmed delivery OK then filed dispute
  if (deliveryOkEvent && order.disputeOpenedAt) {
    const deliveryOkMeta = (deliveryOkEvent.metadata ?? {}) as Record<
      string,
      unknown
    >;
    const condition = deliveryOkMeta.itemCondition ?? "ok";
    alerts.push({
      type: "alert",
      message: `Buyer confirmed delivery as "${String(condition)}" on ${deliveryOkEvent.createdAt.toLocaleDateString("en-NZ")} then filed a dispute${order.disputeOpenedAt ? ` on ${new Date(order.disputeOpenedAt).toLocaleDateString("en-NZ")}` : ""}.`,
      severity: "high",
    });
  }

  // 2. Seller claims shipped but no tracking number
  if (order.dispatchedAt && !order.trackingNumber) {
    alerts.push({
      type: "warning",
      message:
        "Seller marked the order as dispatched but did not provide a tracking number.",
      severity: "medium",
    });
  }

  // 3. Seller has dispatch photos but buyer claims damage (photo conflict)
  if (
    hasDispatchPhotos &&
    (order.disputeReason === "ITEM_NOT_AS_DESCRIBED" ||
      order.disputeReason === "ITEM_DAMAGED")
  ) {
    alerts.push({
      type: "warning",
      message:
        "Seller uploaded dispatch photos but buyer claims the item was damaged or not as described. Compare the photos carefully.",
      severity: "medium",
    });
  }

  // 4. Tracking/completion shows delivered but buyer says not received
  if (order.completedAt && order.disputeReason === "ITEM_NOT_RECEIVED") {
    alerts.push({
      type: "alert",
      message: `Order was marked as delivered/completed on ${new Date(order.completedAt).toLocaleDateString("en-NZ")} but buyer claims item was not received.`,
      severity: "high",
    });
  }

  // 5. Change-of-mind disguised as "not as described"
  if (order.disputeReason === "ITEM_NOT_AS_DESCRIBED" && order.disputeNotes) {
    const notes = order.disputeNotes.toLowerCase();
    const changeOfMindPhrases = [
      "changed my mind",
      "change of mind",
      "don't want",
      "dont want",
      "don't need",
      "dont need",
      "no longer want",
      "no longer need",
      "bought by mistake",
      "wrong purchase",
      "impulse buy",
      "changed mind",
    ];
    const matchedPhrase = changeOfMindPhrases.find((p) => notes.includes(p));
    if (matchedPhrase) {
      alerts.push({
        type: "alert",
        message: `Dispute reason is "not as described" but buyer's description contains "${matchedPhrase}" — may be a change-of-mind disguised as a legitimate complaint.`,
        severity: "high",
      });
    }
  }

  // 6. Buyer high dispute rate
  if (recentBuyerDisputes > 3) {
    alerts.push({
      type: "warning",
      message: `Buyer has filed ${recentBuyerDisputes} disputes in the last 30 days across different orders.`,
      severity: "medium",
    });
  }

  // 7. Seller high dispute rate
  if (sellerMetrics.totalOrders >= 5 && sellerMetrics.disputeRate > 15) {
    alerts.push({
      type: "warning",
      message: `Seller has a ${sellerMetrics.disputeRate}% dispute rate (above 15% threshold).`,
      severity: "medium",
    });
  }

  // 8. Listing condition vs dispute claim mismatch
  if (order.listing?.condition && order.disputeReason) {
    const cond = order.listing.condition.toLowerCase();
    const isLowCondition = ["fair", "good", "poor"].includes(cond);
    const claimsDefect =
      order.disputeReason === "ITEM_NOT_AS_DESCRIBED" ||
      order.disputeReason === "ITEM_DAMAGED";

    if (isLowCondition && claimsDefect && order.disputeNotes) {
      const notes = order.disputeNotes.toLowerCase();
      const wearComplaints = [
        "scratch",
        "worn",
        "wear",
        "dent",
        "scuff",
        "mark",
        "stain",
        "faded",
      ];
      const mentionsWear = wearComplaints.some((w) => notes.includes(w));
      if (mentionsWear) {
        alerts.push({
          type: "warning",
          message: `Listing condition was "${order.listing.condition}" but buyer complains about wear — this may be expected for the listed condition.`,
          severity: "medium",
        });
      }
    }
  }

  // Sort by severity: high first, then medium, then low
  const severityOrder = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}
