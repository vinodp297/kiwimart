// src/modules/admin/admin-disputes.service.ts
// ─── Admin Dispute Data Service ──────────────────────────────────────────
// Fetches categorised dispute queues and detailed case views for admin.

import { Prisma } from "@prisma/client";
import { adminDisputesRepository } from "./admin-disputes.repository";
import { trustMetricsService } from "@/modules/trust/trust-metrics.service";
import { analyzeInconsistencies } from "@/modules/disputes/inconsistency-analysis.service";
import { MS_PER_HOUR, MS_PER_DAY } from "@/lib/time";

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
    isGstRegistered: boolean;
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

// ── Helpers ──────────────────────────────────────────────────────────────

function daysAgo(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / MS_PER_DAY);
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
  const event =
    await adminDisputesRepository.findLatestAutoResolutionEvent(orderId);
  return parseAutoResolutionMeta(event?.metadata);
}

/** Batch-fetch auto-resolution events for multiple orders (avoids N+1). */
async function batchAutoResolutionEvents(
  orderIds: string[],
): Promise<Map<string, DisputeQueueItem["autoResolution"]>> {
  if (orderIds.length === 0) return new Map();
  const events =
    await adminDisputesRepository.findAutoResolutionEventsBatch(orderIds);
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
      adminDisputesRepository.countOpenDisputes(),
      adminDisputesRepository.findAllAutoResolutionEvents(),
      adminDisputesRepository.countResolvedSince(monthStart),
      adminDisputesRepository.countAutoResolvedSince(monthStart),
      adminDisputesRepository.countPickupDisputes(),
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
    const allOpenDisputes = await adminDisputesRepository.findOpenDisputeIds();
    for (const d of allOpenDisputes) {
      if (!disputesWithEvents.has(d.id)) {
        needsDecision++;
      }
    }

    // Average resolution time (from Dispute model)
    const recentResolved = await adminDisputesRepository.findRecentResolved(50);

    let avgResolutionHours = 0;
    if (recentResolved.length > 0) {
      const totalHours = recentResolved.reduce((sum, r) => {
        return (
          sum + (r.resolvedAt!.getTime() - r.openedAt.getTime()) / MS_PER_HOUR
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
      disputes = await adminDisputesRepository.findAutoResolvedQueue();
    } else if (tab === "all") {
      // All disputes (open + resolved)
      disputes = await adminDisputesRepository.findAllDisputeQueue();
    } else {
      // Open disputes only
      disputes = await adminDisputesRepository.findOpenDisputeQueue();
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
    const order = await adminDisputesRepository.findCaseOrder(orderId);

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
      adminDisputesRepository.findCaseTimeline(orderId),
      adminDisputesRepository.findCaseInteractions(orderId),
      adminDisputesRepository
        .findCaseMessageThread(order.buyer.id, order.seller.id)
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
      adminDisputesRepository.findCaseCounterEvidence(orderId),
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
        isGstRegistered: order.seller.isGstRegistered,
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
