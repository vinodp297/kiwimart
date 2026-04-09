// src/modules/admin/admin-disputes.repository.ts
// ─── Admin Disputes Repository — data access for the dispute case view ────────

import db from "@/lib/db";
import { Prisma } from "@prisma/client";

// ── Shared select for dispute queue ──────────────────────────────────────────

const DISPUTE_QUEUE_SELECT = {
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
      isGstRegistered: true,
    },
  },
} satisfies Prisma.OrderSelect;

export const adminDisputesRepository = {
  /** Count all open (DISPUTED) orders. */
  async countOpenDisputes(): Promise<number> {
    return db.order.count({ where: { status: "DISPUTED" } });
  },

  /** Fetch all auto-resolution events for open disputes (for categorisation). */
  async findAllAutoResolutionEvents() {
    return db.orderEvent.findMany({
      where: {
        order: { status: "DISPUTED" },
        type: { in: ["AUTO_RESOLVED", "DISPUTE_RESPONDED", "FRAUD_FLAGGED"] },
        metadata: { path: ["decision"], not: Prisma.JsonNull },
      },
      orderBy: { createdAt: "desc" },
      select: { orderId: true, metadata: true },
    });
  },

  /** Count resolved disputes since a given date. */
  async countResolvedSince(since: Date): Promise<number> {
    return db.dispute.count({
      where: { resolvedAt: { not: null, gte: since } },
    });
  },

  /** Count auto-resolved (EXECUTED) events since a given date. */
  async countAutoResolvedSince(since: Date): Promise<number> {
    return db.orderEvent.count({
      where: {
        type: "AUTO_RESOLVED",
        metadata: { path: ["status"], equals: "EXECUTED" },
        createdAt: { gte: since },
      },
    });
  },

  /** Count open disputes for pickup (non-shipped) orders. */
  async countPickupDisputes(): Promise<number> {
    return db.order.count({
      where: { status: "DISPUTED", fulfillmentType: { not: "SHIPPED" } },
    });
  },

  /** Fetch all open dispute order IDs. */
  async findOpenDisputeIds() {
    return db.order.findMany({
      where: { status: "DISPUTED" },
      select: { id: true },
    });
  },

  /** Fetch recent resolved disputes for avg-resolution-time calculation. */
  async findRecentResolved(limit: number) {
    return db.dispute.findMany({
      where: { resolvedAt: { not: null } },
      select: { openedAt: true, resolvedAt: true },
      take: limit,
      orderBy: { resolvedAt: "desc" },
    });
  },

  /** Fetch disputes for the "auto_resolved" tab. */
  async findAutoResolvedQueue() {
    return db.order.findMany({
      where: {
        dispute: { resolvedAt: { not: null } },
        status: { in: ["COMPLETED", "REFUNDED"] },
      },
      select: DISPUTE_QUEUE_SELECT,
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  },

  /** Fetch all disputes (open + resolved) for the "all" tab. */
  async findAllDisputeQueue() {
    return db.order.findMany({
      where: { dispute: { isNot: null } },
      select: DISPUTE_QUEUE_SELECT,
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
  },

  /** Fetch open disputes for queue tabs. */
  async findOpenDisputeQueue() {
    return db.order.findMany({
      where: { status: "DISPUTED" },
      select: DISPUTE_QUEUE_SELECT,
      orderBy: [{ dispute: { openedAt: "asc" } }, { updatedAt: "asc" }],
    });
  },

  /** Batch-fetch auto-resolution events for multiple orders (avoids N+1). */
  async findAutoResolutionEventsBatch(orderIds: string[]) {
    if (orderIds.length === 0) return [];
    return db.orderEvent.findMany({
      where: {
        orderId: { in: orderIds },
        type: { in: ["AUTO_RESOLVED", "DISPUTE_RESPONDED", "FRAUD_FLAGGED"] },
        metadata: { path: ["decision"], not: Prisma.JsonNull },
      },
      orderBy: { createdAt: "desc" },
      select: { orderId: true, metadata: true },
    });
  },

  /** Find the latest auto-resolution event for a single order. */
  async findLatestAutoResolutionEvent(orderId: string) {
    return db.orderEvent.findFirst({
      where: {
        orderId,
        type: { in: ["AUTO_RESOLVED", "DISPUTE_RESPONDED", "FRAUD_FLAGGED"] },
        metadata: { path: ["decision"], not: Prisma.JsonNull },
      },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
  },

  /** Fetch a single order with full case detail. */
  async findCaseOrder(orderId: string) {
    return db.order.findUnique({
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
            isGstRegistered: true,
            createdAt: true,
          },
        },
      },
    });
  },

  /** Fetch order events (timeline) for a case. */
  async findCaseTimeline(orderId: string) {
    return db.orderEvent.findMany({
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
    });
  },

  /** Fetch order interactions for a case. */
  async findCaseInteractions(orderId: string) {
    return db.orderInteraction.findMany({
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
    });
  },

  /** Fetch the message thread between buyer and seller for a case. */
  async findCaseMessageThread(buyerId: string, sellerId: string) {
    return db.messageThread.findFirst({
      where: {
        OR: [
          { participant1Id: buyerId, participant2Id: sellerId },
          { participant1Id: sellerId, participant2Id: buyerId },
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
    });
  },

  /** Fetch counter-evidence events for a case. */
  async findCaseCounterEvidence(orderId: string) {
    return db.orderEvent.findMany({
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
    });
  },
};
