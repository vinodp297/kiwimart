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
  disputeReason: string | null;
  disputeNotes: string | null;
  disputeOpenedAt: Date | null;
  sellerResponse: string | null;
  sellerRespondedAt: Date | null;
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
}

export interface DisputeQueueStats {
  needsDecision: number;
  coolingPeriod: number;
  fraudAlerts: number;
  autoResolved: number;
  totalOpen: number;
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
    disputeReason: string | null;
    disputeNotes: string | null;
    disputeOpenedAt: Date | null;
    disputeEvidenceUrls: string[];
    sellerResponse: string | null;
    sellerRespondedAt: Date | null;
    disputeResolvedAt: Date | null;
  };
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
}

// ── Shared select for dispute queue ──────────────────────────────────────

const DISPUTE_SELECT = {
  id: true,
  totalNzd: true,
  disputeReason: true,
  disputeNotes: true,
  disputeOpenedAt: true,
  sellerResponse: true,
  sellerRespondedAt: true,
  updatedAt: true,
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
      db.order.count({
        where: {
          disputeResolvedAt: { not: null, gte: monthStart },
        },
      }),
      db.orderEvent.count({
        where: {
          type: "AUTO_RESOLVED",
          metadata: { path: ["status"], equals: "EXECUTED" },
          createdAt: { gte: monthStart },
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

    // Average resolution time
    const recentResolved = await db.order.findMany({
      where: {
        disputeResolvedAt: { not: null },
        disputeOpenedAt: { not: null },
      },
      select: { disputeOpenedAt: true, disputeResolvedAt: true },
      take: 50,
      orderBy: { disputeResolvedAt: "desc" },
    });

    let avgResolutionHours = 0;
    if (recentResolved.length > 0) {
      const totalHours = recentResolved.reduce((sum, r) => {
        return (
          sum +
          (r.disputeResolvedAt!.getTime() - r.disputeOpenedAt!.getTime()) /
            (1000 * 60 * 60)
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
      avgResolutionHours,
      autoResolvedThisMonth,
      autoResolvedPercentThisMonth,
    };
  }

  /**
   * Fetch disputes for a specific queue tab.
   */
  async getDisputeQueue(
    tab: "needs_decision" | "cooling" | "fraud" | "auto_resolved" | "all",
  ): Promise<DisputeQueueItem[]> {
    let disputes;

    if (tab === "auto_resolved") {
      // Show resolved disputes with auto-resolution
      disputes = await db.order.findMany({
        where: {
          disputeResolvedAt: { not: null },
          status: { in: ["COMPLETED", "REFUNDED"] },
        },
        select: DISPUTE_SELECT,
        orderBy: { updatedAt: "desc" },
        take: 50,
      });
    } else if (tab === "all") {
      // All disputes (open + resolved)
      disputes = await db.order.findMany({
        where: { disputeOpenedAt: { not: null } },
        select: DISPUTE_SELECT,
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
    } else {
      // Open disputes only
      disputes = await db.order.findMany({
        where: { status: "DISPUTED" },
        select: DISPUTE_SELECT,
        orderBy: { disputeOpenedAt: "asc" },
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
        ...d,
        autoResolution: autoRes,
        daysOpen: daysAgo(d.disputeOpenedAt ?? d.updatedAt),
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
        disputeReason: true,
        disputeNotes: true,
        disputeOpenedAt: true,
        disputeEvidenceUrls: true,
        sellerResponse: true,
        sellerRespondedAt: true,
        disputeResolvedAt: true,
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
        disputeReason: order.disputeReason,
        disputeNotes: order.disputeNotes,
        disputeOpenedAt: order.disputeOpenedAt,
        disputeEvidenceUrls: order.disputeEvidenceUrls,
        sellerResponse: order.sellerResponse,
        sellerRespondedAt: order.sellerRespondedAt,
        disputeResolvedAt: order.disputeResolvedAt,
      },
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
    };
  }
}

export const adminDisputesService = new AdminDisputesService();
