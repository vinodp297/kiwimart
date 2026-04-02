// src/modules/admin/admin-disputes.service.ts
// ─── Admin Dispute Data Service ──────────────────────────────────────────
// Fetches categorised dispute queues and detailed case views for admin.

import db from "@/lib/db";
import { Prisma } from "@prisma/client";
import { trustMetricsService } from "@/modules/trust/trust-metrics.service";
import { analyzeInconsistencies } from "@/modules/disputes/inconsistency-analysis.service";

// ── Types ─────────────────────────────────────────────────────────────────

export interface DisputeQueueItem {
  id: string;
  totalNzd: number;
  updatedAt: Date;
  listing: {
    id: string;
    title: string;
    priceNzd: number;
    images: { r2Key: string; thumbnailKey: string | null }[];
  };
  buyer: { id: string; email: string; displayName: string };
  seller: {
    id: string;
    email: string;
    displayName: string;
    idVerified: boolean;
  };
  // Dispute data from standalone Dispute model
  dispute: {
    id: string;
    reason: string;
    status: string;
    source: string;
    buyerStatement: string | null;
    sellerStatement: string | null;
    openedAt: Date;
    sellerRespondedAt: Date | null;
    resolvedAt: Date | null;
  } | null;
  // Auto-resolution data (from OrderEvent metadata)
  autoResolution: {
    decision: string;
    score: number;
    recommendation: string;
    status: string; // QUEUED, EXECUTED, ESCALATED, FLAGGED
    executeAt: string | null;
    factors: Array<{ factor: string; points: number; description: string }>;
  } | null;
  // Days open
  daysOpen: number;
  // Pickup
  fulfillmentType: string;
}

export interface DisputeQueueStats {
  needsDecision: number;
  coolingPeriod: number;
  fraudAlerts: number;
  autoResolved: number;
  totalOpen: number;
  pickupOrders: number;
  avgResolutionHours: number;
  autoResolvedThisMonth: number;
  autoResolvedPercentThisMonth: number;
}

export interface DisputeCaseDetail {
  order: {
    id: string;
    totalNzd: number;
    status: string;
    createdAt: Date;
    dispatchedAt: Date | null;
    completedAt: Date | null;
    trackingNumber: string | null;
    stripePaymentIntentId: string | null;
    // Pickup fields
    fulfillmentType: string;
    pickupStatus: string | null;
    pickupScheduledAt: Date | null;
    otpInitiatedAt: Date | null;
    pickupConfirmedAt: Date | null;
    pickupRejectedAt: Date | null;
    rescheduleCount: number;
    pickupRescheduleRequests: Array<{
      id: string;
      requestedByRole: string;
      sellerReason: string | null;
      buyerReason: string | null;
      reasonNote: string | null;
      proposedTime: Date;
      status: string;
      responseNote: string | null;
      respondedAt: Date | null;
      createdAt: Date;
      requestedBy: { displayName: string | null };
    }>;
  };
  dispute: {
    id: string;
    reason: string;
    status: string;
    source: string;
    buyerStatement: string | null;
    sellerStatement: string | null;
    adminNotes: string | null;
    resolution: string | null;
    refundAmount: number | null;
    autoResolutionScore: number | null;
    autoResolutionReason: string | null;
    openedAt: Date;
    sellerRespondedAt: Date | null;
    resolvedAt: Date | null;
    evidence: Array<{
      id: string;
      r2Key: string;
      uploadedBy: string;
      label: string | null;
      createdAt: Date;
    }>;
  } | null;
  listing: {
    id: string;
    title: string;
    description: string;
    condition: string | null;
    priceNzd: number;
    images: { r2Key: string; thumbnailKey: string | null }[];
  };
  buyer: {
    id: string;
    email: string;
    displayName: string;
    createdAt: Date;
    metrics: {
      totalOrders: number;
      completedOrders: number;
      disputeCount: number;
      disputeRate: number;
      disputesLast30Days: number;
      accountAgeDays: number;
      isFlaggedForFraud: boolean;
    };
  };
  seller: {
    id: string;
    email: string;
    displayName: string;
    idVerified: boolean;
    nzbn: string | null;
    gstRegistered: boolean;
    createdAt: Date;
    metrics: {
      totalOrders: number;
      completedOrders: number;
      disputeCount: number;
      disputeRate: number;
      averageResponseHours: number | null;
      averageRating: number | null;
      dispatchPhotoRate: number;
      accountAgeDays: number;
      isFlaggedForFraud: boolean;
    };
  };
  timeline: Array<{
    id: string;
    type: string;
    actorRole: string;
    summary: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    actor: { id: string; displayName: string | null; username: string } | null;
  }>;
  interactions: Array<{
    id: string;
    type: string;
    status: string;
    reason: string | null;
    responseNote: string | null;
    createdAt: Date;
    expiresAt: Date | null;
    initiatedBy: { displayName: string } | null;
    responseBy: { displayName: string } | null;
  }>;
  messages: Array<{
    id: string;
    content: string;
    createdAt: Date;
    sender: { displayName: string };
  }>;
  autoResolution: {
    decision: string;
    score: number;
    recommendation: string;
    status: string;
    executeAt: string | null;
    factors: Array<{ factor: string; points: number; description: string }>;
  } | null;
  inconsistencies: Array<{
    type: "warning" | "alert";
    message: string;
    severity: "low" | "medium" | "high";
  }>;
  counterEvidence: Array<{
    id: string;
    actorRole: string;
    summary: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    actor: { displayName: string | null } | null;
  }>;
  snapshot: {
    title: string;
    description: string;
    condition: string;
    priceNzd: number;
    shippingNzd: number;
    categoryName: string;
    subcategoryName: string | null;
    shippingOption: string;
    isNegotiable: boolean;
    images: unknown; // JSON — cast to SnapshotImage[] at the UI layer
    attributes: unknown; // JSON — cast to SnapshotAttribute[] at the UI layer
    capturedAt: Date;
  } | null;
}

// ── Shared select for dispute queue ──────────────────────────────────────

const DISPUTE_SELECT = {
  id: true,
  totalNzd: true,
  updatedAt: true,
  fulfillmentType: true,
  dispute: {
    select: {
      id: true,
      reason: true,
      status: true,
      source: true,
      buyerStatement: true,
      sellerStatement: true,
      openedAt: true,
      sellerRespondedAt: true,
      resolvedAt: true,
    },
  },
  listing: {
    select: {
      id: true,
      title: true,
      priceNzd: true,
      images: {
        where: { order: 0 },
        select: { r2Key: true, thumbnailKey: true },
        take: 1,
      },
    },
  },
  buyer: { select: { id: true, email: true, displayName: true } },
  seller: {
    select: {
      id: true,
      email: true,
      displayName: true,
      idVerified: true,
      nzbn: true,
      gstRegistered: true,
    },
  },
} satisfies Prisma.OrderSelect;

// ── Helpers ──────────────────────────────────────────────────────────────

function daysAgo(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function parseAutoResolutionMeta(
  metadata: unknown,
): DisputeQueueItem["autoResolution"] {
  if (!metadata) return null;
  const meta = metadata as Record<string, unknown>;
  if (!meta.decision) return null;
  return {
    decision: String(meta.decision),
    score: Number(meta.score ?? 0),
    recommendation: String(meta.recommendation ?? ""),
    status: String(meta.status ?? "UNKNOWN"),
    executeAt: meta.executeAt ? String(meta.executeAt) : null,
    factors: Array.isArray(meta.factors)
      ? (meta.factors as Array<{
          factor: string;
          points: number;
          description: string;
        }>)
      : [],
  };
}

async function getAutoResolutionEvent(orderId: string) {
  const event = await db.orderEvent.findFirst({
    where: {
      orderId,
      type: { in: ["AUTO_RESOLVED", "DISPUTE_RESPONDED", "FRAUD_FLAGGED"] },
      metadata: { path: ["decision"], not: Prisma.JsonNull },
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  return parseAutoResolutionMeta(event?.metadata);
}

/** Batch-fetch auto-resolution events for multiple orders (avoids N+1). */
async function batchAutoResolutionEvents(
  orderIds: string[],
): Promise<Map<string, DisputeQueueItem["autoResolution"]>> {
  if (orderIds.length === 0) return new Map();
  const events = await db.orderEvent.findMany({
    where: {
      orderId: { in: orderIds },
      type: { in: ["AUTO_RESOLVED", "DISPUTE_RESPONDED", "FRAUD_FLAGGED"] },
      metadata: { path: ["decision"], not: Prisma.JsonNull },
    },
    orderBy: { createdAt: "desc" },
    select: { orderId: true, metadata: true },
  });
  // Keep only the newest event per order
  const map = new Map<string, DisputeQueueItem["autoResolution"]>();
  for (const ev of events) {
    if (map.has(ev.orderId)) continue;
    map.set(ev.orderId, parseAutoResolutionMeta(ev.metadata));
  }
  return map;
}

// ── Service ──────────────────────────────────────────────────────────────

export class AdminDisputesService {
  /**
   * Get dispute queue stats for the dashboard header.
   */
  async getQueueStats(): Promise<DisputeQueueStats> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      totalOpen,
      allDisputeEvents,
      resolvedThisMonth,
      autoResolvedThisMonth,
      pickupOrders,
    ] = await Promise.all([
      db.order.count({ where: { status: "DISPUTED" } }),
      db.orderEvent.findMany({
        where: {
          order: { status: "DISPUTED" },
          type: { in: ["AUTO_RESOLVED", "DISPUTE_RESPONDED", "FRAUD_FLAGGED"] },
          metadata: {
            path: ["decision"],
            not: Prisma.JsonNull,
          },
        },
        orderBy: { createdAt: "desc" },
        select: { orderId: true, metadata: true },
      }),
      db.dispute.count({
        where: {
          resolvedAt: { not: null, gte: monthStart },
        },
      }),
      db.orderEvent.count({
        where: {
          type: "AUTO_RESOLVED",
          metadata: { path: ["status"], equals: "EXECUTED" },
          createdAt: { gte: monthStart },
        },
      }),
      db.order.count({
        where: {
          status: "DISPUTED",
          fulfillmentType: { not: "SHIPPED" },
        },
      }),
    ]);

    // Categorize disputes by scanning their latest auto-resolution event
    const disputeCategories = new Map<
      string,
      { decision: string; status: string }
    >();
    for (const ev of allDisputeEvents) {
      if (disputeCategories.has(ev.orderId)) continue; // already have newest
      const meta = ev.metadata as Record<string, unknown>;
      disputeCategories.set(ev.orderId, {
        decision: String(meta.decision ?? ""),
        status: String(meta.status ?? ""),
      });
    }

    let needsDecision = 0;
    let coolingPeriod = 0;
    let fraudAlerts = 0;

    for (const { decision, status } of disputeCategories.values()) {
      if (decision === "FLAG_FRAUD" || status === "FLAGGED") {
        fraudAlerts++;
      } else if (status === "QUEUED") {
        coolingPeriod++;
      } else if (decision === "ESCALATE_HUMAN" || status === "ESCALATED") {
        needsDecision++;
      }
    }

    // Any open disputes without auto-resolution events also need decisions
    const disputesWithEvents = new Set(disputeCategories.keys());
    const allOpenDisputes = await db.order.findMany({
      where: { status: "DISPUTED" },
      select: { id: true },
    });
    for (const d of allOpenDisputes) {
      if (!disputesWithEvents.has(d.id)) {
        needsDecision++;
      }
    }

    // Average resolution time (from Dispute model)
    const recentResolved = await db.dispute.findMany({
      where: {
        resolvedAt: { not: null },
      },
      select: { openedAt: true, resolvedAt: true },
      take: 50,
      orderBy: { resolvedAt: "desc" },
    });

    let avgResolutionHours = 0;
    if (recentResolved.length > 0) {
      const totalHours = recentResolved.reduce((sum, r) => {
        return (
          sum +
          (r.resolvedAt!.getTime() - r.openedAt.getTime()) / (1000 * 60 * 60)
        );
      }, 0);
      avgResolutionHours = Math.round(totalHours / recentResolved.length);
    }

    const totalResolvedThisMonth = resolvedThisMonth || 1;
    const autoResolvedPercentThisMonth = Math.round(
      (autoResolvedThisMonth / totalResolvedThisMonth) * 100,
    );

    return {
      needsDecision,
      coolingPeriod,
      fraudAlerts,
      autoResolved: autoResolvedThisMonth,
      totalOpen,
      pickupOrders,
      avgResolutionHours,
      autoResolvedThisMonth,
      autoResolvedPercentThisMonth,
    };
  }

  /**
   * Fetch disputes for a specific queue tab.
   */
  async getDisputeQueue(
    tab:
      | "needs_decision"
      | "cooling"
      | "fraud"
      | "auto_resolved"
      | "pickup"
      | "all",
  ): Promise<DisputeQueueItem[]> {
    let disputes;

    if (tab === "auto_resolved") {
      // Show resolved disputes with auto-resolution
      disputes = await db.order.findMany({
        where: {
          dispute: { resolvedAt: { not: null } },
          status: { in: ["COMPLETED", "REFUNDED"] },
        },
        select: DISPUTE_SELECT,
        orderBy: { updatedAt: "desc" },
        take: 50,
      });
    } else if (tab === "all") {
      // All disputes (open + resolved)
      disputes = await db.order.findMany({
        where: { dispute: { isNot: null } },
        select: DISPUTE_SELECT,
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
    } else {
      // Open disputes only
      disputes = await db.order.findMany({
        where: { status: "DISPUTED" },
        select: DISPUTE_SELECT,
        orderBy: [{ dispute: { openedAt: "asc" } }, { updatedAt: "asc" }],
      });
    }

    // Batch-fetch auto-resolution data for all disputes (no N+1)
    const autoResMap = await batchAutoResolutionEvents(
      disputes.map((d) => d.id),
    );

    const items: DisputeQueueItem[] = [];
    for (const d of disputes) {
      const autoRes = autoResMap.get(d.id) ?? null;
      const item: DisputeQueueItem = {
        id: d.id,
        totalNzd: d.totalNzd,
        updatedAt: d.updatedAt,
        listing: d.listing,
        buyer: d.buyer,
        seller: d.seller,
        dispute: d.dispute ?? null,
        autoResolution: autoRes,
        daysOpen: daysAgo(d.dispute?.openedAt ?? d.updatedAt),
        fulfillmentType: d.fulfillmentType,
      };

      // Filter by tab
      if (tab === "needs_decision") {
        const isEscalated =
          !autoRes ||
          autoRes.decision === "ESCALATE_HUMAN" ||
          autoRes.status === "ESCALATED";
        if (!isEscalated) continue;
      } else if (tab === "cooling") {
        if (!autoRes || autoRes.status !== "QUEUED") continue;
      } else if (tab === "fraud") {
        if (
          !autoRes ||
          (autoRes.decision !== "FLAG_FRAUD" && autoRes.status !== "FLAGGED")
        )
          continue;
      } else if (tab === "auto_resolved") {
        if (!autoRes || autoRes.status !== "EXECUTED") continue;
      } else if (tab === "pickup") {
        if (item.fulfillmentType === "SHIPPED") continue;
      }

      items.push(item);
    }

    return items;
  }

  /**
   * Fetch detailed case view for a single dispute.
   */
  async getCaseDetail(orderId: string): Promise<DisputeCaseDetail | null> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        totalNzd: true,
        status: true,
        createdAt: true,
        dispatchedAt: true,
        completedAt: true,
        trackingNumber: true,
        stripePaymentIntentId: true,
        fulfillmentType: true,
        dispute: {
          select: {
            id: true,
            reason: true,
            status: true,
            source: true,
            buyerStatement: true,
            sellerStatement: true,
            adminNotes: true,
            resolution: true,
            refundAmount: true,
            autoResolutionScore: true,
            autoResolutionReason: true,
            openedAt: true,
            sellerRespondedAt: true,
            resolvedAt: true,
            evidence: {
              select: {
                id: true,
                r2Key: true,
                uploadedBy: true,
                label: true,
                createdAt: true,
              },
              orderBy: { createdAt: "asc" as const },
            },
          },
        },
        pickupStatus: true,
        pickupScheduledAt: true,
        otpInitiatedAt: true,
        pickupConfirmedAt: true,
        pickupRejectedAt: true,
        rescheduleCount: true,
        pickupRescheduleRequests: {
          orderBy: { createdAt: "asc" as const },
          select: {
            id: true,
            requestedByRole: true,
            sellerReason: true,
            buyerReason: true,
            reasonNote: true,
            proposedTime: true,
            status: true,
            responseNote: true,
            respondedAt: true,
            createdAt: true,
            requestedBy: { select: { displayName: true } },
          },
        },
        listing: {
          select: {
            id: true,
            title: true,
            description: true,
            condition: true,
            priceNzd: true,
            images: {
              select: { r2Key: true, thumbnailKey: true },
              orderBy: { order: "asc" },
            },
          },
        },
        snapshot: {
          select: {
            title: true,
            description: true,
            condition: true,
            priceNzd: true,
            shippingNzd: true,
            categoryName: true,
            subcategoryName: true,
            shippingOption: true,
            isNegotiable: true,
            images: true,
            attributes: true,
            capturedAt: true,
          },
        },
        buyer: {
          select: {
            id: true,
            email: true,
            displayName: true,
            createdAt: true,
          },
        },
        seller: {
          select: {
            id: true,
            email: true,
            displayName: true,
            idVerified: true,
            nzbn: true,
            gstRegistered: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) return null;

    // Parallel data fetching
    const [
      timeline,
      interactions,
      messageThread,
      buyerMetricsRaw,
      sellerMetricsRaw,
      autoRes,
      inconsistencies,
      counterEvidenceEvents,
    ] = await Promise.all([
      db.orderEvent.findMany({
        where: { orderId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          actorRole: true,
          summary: true,
          metadata: true,
          createdAt: true,
          actor: {
            select: { id: true, displayName: true, username: true },
          },
        },
      }),
      db.orderInteraction.findMany({
        where: { orderId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          status: true,
          reason: true,
          responseNote: true,
          createdAt: true,
          expiresAt: true,
          initiator: { select: { displayName: true } },
          responder: { select: { displayName: true } },
        },
      }),
      // Get message thread between buyer and seller about this order
      db.messageThread
        .findFirst({
          where: {
            OR: [
              {
                participant1Id: order.buyer.id,
                participant2Id: order.seller.id,
              },
              {
                participant1Id: order.seller.id,
                participant2Id: order.buyer.id,
              },
            ],
          },
          select: {
            messages: {
              orderBy: { createdAt: "asc" },
              take: 50,
              select: {
                id: true,
                body: true,
                createdAt: true,
                sender: { select: { displayName: true } },
              },
            },
          },
        })
        .then((t) =>
          (t?.messages ?? []).map((m) => ({
            id: m.id,
            content: m.body,
            createdAt: m.createdAt,
            sender: m.sender,
          })),
        ),
      trustMetricsService.getMetrics(order.buyer.id),
      trustMetricsService.getMetrics(order.seller.id),
      getAutoResolutionEvent(orderId),
      analyzeInconsistencies(orderId),
      // Counter-evidence events
      db.orderEvent.findMany({
        where: {
          orderId,
          type: "DISPUTE_RESPONDED",
          metadata: {
            path: ["counterEvidenceFor"],
            not: Prisma.JsonNull,
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          actorRole: true,
          summary: true,
          metadata: true,
          createdAt: true,
          actor: { select: { displayName: true } },
        },
      }),
    ]);

    return {
      order: {
        id: order.id,
        totalNzd: order.totalNzd,
        status: order.status,
        createdAt: order.createdAt,
        dispatchedAt: order.dispatchedAt,
        completedAt: order.completedAt,
        trackingNumber: order.trackingNumber,
        stripePaymentIntentId: order.stripePaymentIntentId,
        fulfillmentType: order.fulfillmentType,
        pickupStatus: order.pickupStatus,
        pickupScheduledAt: order.pickupScheduledAt,
        otpInitiatedAt: order.otpInitiatedAt,
        pickupConfirmedAt: order.pickupConfirmedAt,
        pickupRejectedAt: order.pickupRejectedAt,
        rescheduleCount: order.rescheduleCount,
        pickupRescheduleRequests: order.pickupRescheduleRequests,
      },
      dispute: order.dispute
        ? {
            id: order.dispute.id,
            reason: order.dispute.reason,
            status: order.dispute.status,
            source: order.dispute.source,
            buyerStatement: order.dispute.buyerStatement,
            sellerStatement: order.dispute.sellerStatement,
            adminNotes: order.dispute.adminNotes,
            resolution: order.dispute.resolution,
            refundAmount: order.dispute.refundAmount,
            autoResolutionScore: order.dispute.autoResolutionScore,
            autoResolutionReason: order.dispute.autoResolutionReason,
            openedAt: order.dispute.openedAt,
            sellerRespondedAt: order.dispute.sellerRespondedAt,
            resolvedAt: order.dispute.resolvedAt,
            evidence: order.dispute.evidence,
          }
        : null,
      listing: order.listing,
      buyer: {
        id: order.buyer.id,
        email: order.buyer.email,
        displayName: order.buyer.displayName,
        createdAt: order.buyer.createdAt,
        metrics: {
          totalOrders: buyerMetricsRaw.totalOrders,
          completedOrders: buyerMetricsRaw.completedOrders,
          disputeCount: buyerMetricsRaw.disputeCount,
          disputeRate: buyerMetricsRaw.disputeRate,
          disputesLast30Days: buyerMetricsRaw.disputesLast30Days,
          accountAgeDays: buyerMetricsRaw.accountAgeDays,
          isFlaggedForFraud: buyerMetricsRaw.isFlaggedForFraud,
        },
      },
      seller: {
        id: order.seller.id,
        email: order.seller.email,
        displayName: order.seller.displayName,
        idVerified: order.seller.idVerified,
        nzbn: order.seller.nzbn,
        gstRegistered: order.seller.gstRegistered,
        createdAt: order.seller.createdAt,
        metrics: {
          totalOrders: sellerMetricsRaw.totalOrders,
          completedOrders: sellerMetricsRaw.completedOrders,
          disputeCount: sellerMetricsRaw.disputeCount,
          disputeRate: sellerMetricsRaw.disputeRate,
          averageResponseHours: sellerMetricsRaw.averageResponseHours,
          averageRating: sellerMetricsRaw.averageRating,
          dispatchPhotoRate: sellerMetricsRaw.dispatchPhotoRate,
          accountAgeDays: sellerMetricsRaw.accountAgeDays,
          isFlaggedForFraud: sellerMetricsRaw.isFlaggedForFraud,
        },
      },
      timeline: timeline.map((e) => ({
        ...e,
        metadata: e.metadata as Record<string, unknown> | null,
      })),
      interactions: interactions.map((i) => ({
        ...i,
        initiatedBy: i.initiator,
        responseBy: i.responder,
      })),
      messages: messageThread,
      autoResolution: autoRes,
      inconsistencies,
      counterEvidence: counterEvidenceEvents.map((e) => ({
        ...e,
        metadata: e.metadata as Record<string, unknown> | null,
      })),
      snapshot: order.snapshot
        ? {
            title: order.snapshot.title,
            description: order.snapshot.description,
            condition: order.snapshot.condition,
            priceNzd: order.snapshot.priceNzd,
            shippingNzd: order.snapshot.shippingNzd,
            categoryName: order.snapshot.categoryName,
            subcategoryName: order.snapshot.subcategoryName,
            shippingOption: order.snapshot.shippingOption,
            isNegotiable: order.snapshot.isNegotiable,
            images: order.snapshot.images,
            attributes: order.snapshot.attributes,
            capturedAt: order.snapshot.capturedAt,
          }
        : null,
    };
  }
}

export const adminDisputesService = new AdminDisputesService();
