// src/modules/disputes/auto-resolution.service.ts
// ─── Auto-Resolution Engine ────────────────────────────────────────────────
// Evaluates disputed orders using evidence scoring and returns a recommendation.
// Supports a 24-hour cooling period before execution so the other party can
// submit counter-evidence.

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { paymentService } from "@/modules/payments/payment.service";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { createNotification } from "@/modules/notifications/notification.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { trustMetricsService } from "@/modules/trust/trust-metrics.service";
import { audit } from "@/server/lib/audit";

// ── Scoring Configuration ─────────────────────────────────────────────────
// All weights in one place — easy to extract to DB/env later.

export const RESOLUTION_WEIGHTS = {
  // Favour buyer (positive score)
  NO_TRACKING_NUMBER: 30,
  TRACKING_NO_MOVEMENT_7D: 25,
  NO_DISPATCH_PHOTOS: 20,
  SELLER_UNRESPONSIVE_72H: 25,
  SELLER_HIGH_DISPUTE_RATE: 15,
  BUYER_UPLOADED_EVIDENCE: 10,
  BUYER_ATTEMPTED_RESOLUTION: 10,
  SELLER_REJECTED_WITHOUT_COUNTER: 10,

  // Favour seller (negative score)
  BUYER_CONFIRMED_DELIVERY_OK: -30,
  TRACKING_SHOWS_DELIVERED: -25,
  SELLER_HAS_DISPATCH_PHOTOS: -15,
  SELLER_RESPONDED_WITH_EVIDENCE: -15,
  BUYER_HIGH_DISPUTE_RATE: -20,
  DISPUTE_IS_CHANGE_OF_MIND: -25,
  SELLER_LOW_DISPUTE_RATE: -10,

  // Decision thresholds
  AUTO_REFUND_THRESHOLD: 60,
  AUTO_DISMISS_THRESHOLD: -40,

  // Fraud detection
  BUYER_FRAUD_DISPUTE_LIMIT: 5,
  SELLER_FRAUD_DISPUTE_RATE: 0.2,

  // Rate limiting — skip auto-resolution after N disputes
  BUYER_HUMAN_REVIEW_AFTER: 3,

  // Cooling period before execution (hours)
  COOLING_PERIOD_HOURS: 24,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────

export type AutoResolutionDecision =
  | "AUTO_REFUND"
  | "AUTO_DISMISS"
  | "ESCALATE_HUMAN"
  | "FLAG_FRAUD";

export interface EvidenceFactor {
  factor: string;
  points: number;
  description: string;
}

export interface DisputeEvaluation {
  score: number;
  decision: AutoResolutionDecision;
  factors: EvidenceFactor[];
  recommendation: string;
  coolingPeriodHours: number;
  canAutoResolve: boolean;
}

// ── Service ───────────────────────────────────────────────────────────────

export class AutoResolutionService {
  /**
   * Evaluate a disputed order and return a resolution recommendation.
   */
  async evaluateDispute(orderId: string): Promise<DisputeEvaluation> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        totalNzd: true,
        trackingNumber: true,
        dispatchedAt: true,
        completedAt: true,
        disputeReason: true,
        disputeOpenedAt: true,
        disputeNotes: true,
        disputeEvidenceUrls: true,
        sellerResponse: true,
        sellerRespondedAt: true,
        stripePaymentIntentId: true,
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    const factors: EvidenceFactor[] = [];
    let score = 0;
    const W = RESOLUTION_WEIGHTS;

    // Fetch trust metrics
    const [buyerMetrics, sellerMetrics] = await Promise.all([
      trustMetricsService.getBuyerMetrics(order.buyerId),
      trustMetricsService.getSellerMetrics(order.sellerId),
    ]);

    // ── Rate limiting check ─────────────────────────────────────────
    if (buyerMetrics.disputesLast30Days > W.BUYER_HUMAN_REVIEW_AFTER) {
      return {
        score: 0,
        decision: "ESCALATE_HUMAN",
        factors: [
          {
            factor: "BUYER_DISPUTE_RATE_LIMITED",
            points: 0,
            description: `Buyer has ${buyerMetrics.disputesLast30Days} disputes in 30 days — auto-resolution skipped, requires human review`,
          },
        ],
        recommendation: `Escalated: Buyer exceeded auto-resolution threshold (${buyerMetrics.disputesLast30Days} disputes in 30 days).`,
        coolingPeriodHours: 0,
        canAutoResolve: false,
      };
    }

    // ── Factors that FAVOUR BUYER (increase score) ──────────────────

    if (!order.trackingNumber) {
      score += W.NO_TRACKING_NUMBER;
      factors.push({
        factor: "NO_TRACKING_NUMBER",
        points: W.NO_TRACKING_NUMBER,
        description: "Seller did not provide a tracking number",
      });
    }

    if (order.dispatchedAt) {
      const daysSinceDispatch =
        (Date.now() - order.dispatchedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceDispatch >= 7 && !order.completedAt) {
        score += W.TRACKING_NO_MOVEMENT_7D;
        factors.push({
          factor: "TRACKING_NO_MOVEMENT_7D",
          points: W.TRACKING_NO_MOVEMENT_7D,
          description: `Dispatched ${Math.floor(daysSinceDispatch)} days ago with no delivery confirmation`,
        });
      }
    }

    // Check dispatch photos
    const dispatchEvent = await db.orderEvent.findFirst({
      where: { orderId, type: "DISPATCHED" },
      select: { metadata: true },
    });
    const dispatchMeta = (dispatchEvent?.metadata ?? {}) as Record<
      string,
      unknown
    >;
    const hasDispatchPhotos =
      Array.isArray(dispatchMeta.dispatchPhotos) &&
      dispatchMeta.dispatchPhotos.length > 0;

    if (!hasDispatchPhotos) {
      score += W.NO_DISPATCH_PHOTOS;
      factors.push({
        factor: "NO_DISPATCH_PHOTOS",
        points: W.NO_DISPATCH_PHOTOS,
        description: "Seller did not upload dispatch evidence photos",
      });
    }

    if (order.disputeOpenedAt && !order.sellerRespondedAt) {
      const hoursSinceDispute =
        (Date.now() - order.disputeOpenedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceDispute >= 72) {
        score += W.SELLER_UNRESPONSIVE_72H;
        factors.push({
          factor: "SELLER_UNRESPONSIVE_72H",
          points: W.SELLER_UNRESPONSIVE_72H,
          description: `Seller has not responded (${Math.floor(hoursSinceDispute)}h elapsed)`,
        });
      }
    }

    if (sellerMetrics.totalOrders >= 5 && sellerMetrics.disputeRate > 15) {
      score += W.SELLER_HIGH_DISPUTE_RATE;
      factors.push({
        factor: "SELLER_HIGH_DISPUTE_RATE",
        points: W.SELLER_HIGH_DISPUTE_RATE,
        description: `Seller dispute rate: ${sellerMetrics.disputeRate}%`,
      });
    }

    if (order.disputeEvidenceUrls.length > 0) {
      score += W.BUYER_UPLOADED_EVIDENCE;
      factors.push({
        factor: "BUYER_UPLOADED_EVIDENCE",
        points: W.BUYER_UPLOADED_EVIDENCE,
        description: `Buyer uploaded ${order.disputeEvidenceUrls.length} evidence photo(s)`,
      });
    }

    const priorInteractions = await db.orderInteraction.count({
      where: {
        orderId,
        initiatedById: order.buyerId,
        createdAt: { lt: order.disputeOpenedAt ?? new Date() },
      },
    });
    if (priorInteractions > 0) {
      score += W.BUYER_ATTEMPTED_RESOLUTION;
      factors.push({
        factor: "BUYER_ATTEMPTED_RESOLUTION",
        points: W.BUYER_ATTEMPTED_RESOLUTION,
        description: `Buyer filed ${priorInteractions} interaction(s) before opening dispute`,
      });
    }

    const rejectedInteraction = await db.orderInteraction.findFirst({
      where: {
        orderId,
        status: "REJECTED",
        responseById: order.sellerId,
      },
      orderBy: { createdAt: "desc" },
    });
    if (rejectedInteraction) {
      score += W.SELLER_REJECTED_WITHOUT_COUNTER;
      factors.push({
        factor: "SELLER_REJECTED_WITHOUT_COUNTER",
        points: W.SELLER_REJECTED_WITHOUT_COUNTER,
        description:
          "Seller rejected buyer's previous request without counter-offer",
      });
    }

    // ── Factors that FAVOUR SELLER (decrease score) ─────────────────

    const deliveryOkEvent = await db.orderEvent.findFirst({
      where: { orderId, type: "DELIVERY_CONFIRMED_OK" },
    });
    if (deliveryOkEvent) {
      score += W.BUYER_CONFIRMED_DELIVERY_OK;
      factors.push({
        factor: "BUYER_CONFIRMED_DELIVERY_OK",
        points: W.BUYER_CONFIRMED_DELIVERY_OK,
        description: 'Buyer previously confirmed item arrived "as described"',
      });
    }

    if (order.completedAt) {
      score += W.TRACKING_SHOWS_DELIVERED;
      factors.push({
        factor: "TRACKING_SHOWS_DELIVERED",
        points: W.TRACKING_SHOWS_DELIVERED,
        description: "Order was completed/delivered before dispute",
      });
    }

    if (hasDispatchPhotos) {
      score += W.SELLER_HAS_DISPATCH_PHOTOS;
      factors.push({
        factor: "SELLER_HAS_DISPATCH_PHOTOS",
        points: W.SELLER_HAS_DISPATCH_PHOTOS,
        description: `Seller uploaded ${(dispatchMeta.dispatchPhotos as unknown[]).length} dispatch photo(s)`,
      });
    }

    if (order.sellerResponse) {
      score += W.SELLER_RESPONDED_WITH_EVIDENCE;
      factors.push({
        factor: "SELLER_RESPONDED_WITH_EVIDENCE",
        points: W.SELLER_RESPONDED_WITH_EVIDENCE,
        description: "Seller provided a written response to the dispute",
      });
    }

    if (buyerMetrics.disputesLast30Days > 5) {
      score += W.BUYER_HIGH_DISPUTE_RATE;
      factors.push({
        factor: "BUYER_HIGH_DISPUTE_RATE",
        points: W.BUYER_HIGH_DISPUTE_RATE,
        description: `Buyer has ${buyerMetrics.disputesLast30Days} disputes in the last 30 days`,
      });
    }

    if (order.disputeReason === "OTHER") {
      score += W.DISPUTE_IS_CHANGE_OF_MIND;
      factors.push({
        factor: "DISPUTE_IS_CHANGE_OF_MIND",
        points: W.DISPUTE_IS_CHANGE_OF_MIND,
        description: `Dispute reason: "${order.disputeReason}" — no specific issue`,
      });
    }

    if (sellerMetrics.totalOrders >= 5 && sellerMetrics.disputeRate < 5) {
      score += W.SELLER_LOW_DISPUTE_RATE;
      factors.push({
        factor: "SELLER_LOW_DISPUTE_RATE",
        points: W.SELLER_LOW_DISPUTE_RATE,
        description: `Seller has excellent track record: ${sellerMetrics.disputeRate}% dispute rate`,
      });
    }

    // ── Special override: photos conflict with "not as described" ────
    // If seller has dispatch photos AND buyer claims not-as-described, always escalate
    if (
      hasDispatchPhotos &&
      (order.disputeReason === "ITEM_NOT_AS_DESCRIBED" ||
        order.disputeReason === "ITEM_DAMAGED")
    ) {
      return {
        score,
        decision: "ESCALATE_HUMAN",
        factors: [
          ...factors,
          {
            factor: "PHOTO_CONFLICT_OVERRIDE",
            points: 0,
            description:
              "Seller has dispatch photos but buyer claims damage/mismatch — requires human review",
          },
        ],
        recommendation: `Escalated: Dispatch photos exist but buyer claims ${order.disputeReason.replace(/_/g, " ").toLowerCase()}. Score: ${score}. Needs human comparison.`,
        coolingPeriodHours: 0,
        canAutoResolve: false,
      };
    }

    // ── Fraud check ─────────────────────────────────────────────────
    if (
      buyerMetrics.disputesLast30Days > W.BUYER_FRAUD_DISPUTE_LIMIT ||
      (sellerMetrics.totalOrders >= 5 &&
        sellerMetrics.disputeRate / 100 > W.SELLER_FRAUD_DISPUTE_RATE)
    ) {
      const flagTarget =
        buyerMetrics.disputesLast30Days > W.BUYER_FRAUD_DISPUTE_LIMIT
          ? "buyer"
          : "seller";

      return {
        score,
        decision: "FLAG_FRAUD",
        factors,
        recommendation: `FRAUD FLAG: ${flagTarget === "buyer" ? `Buyer has ${buyerMetrics.disputesLast30Days} disputes in 30 days` : `Seller dispute rate ${sellerMetrics.disputeRate}%`}. Score: ${score}. Manual review required.`,
        coolingPeriodHours: 0,
        canAutoResolve: false,
      };
    }

    // ── Decision ────────────────────────────────────────────────────
    let decision: AutoResolutionDecision;
    let recommendation: string;
    let canAutoResolve = false;

    if (score >= W.AUTO_REFUND_THRESHOLD) {
      decision = "AUTO_REFUND";
      canAutoResolve = true;
      recommendation = `Auto-refund recommended. Score: +${score}. Key factors: ${factors
        .filter((f) => f.points > 0)
        .map((f) => f.description)
        .join("; ")}.`;
    } else if (score <= W.AUTO_DISMISS_THRESHOLD) {
      decision = "AUTO_DISMISS";
      canAutoResolve = true;
      recommendation = `Auto-dismiss recommended. Score: ${score}. Key factors: ${factors
        .filter((f) => f.points < 0)
        .map((f) => f.description)
        .join("; ")}.`;
    } else {
      decision = "ESCALATE_HUMAN";
      recommendation = `Escalated for admin review. Score: ${score}. Mixed evidence — top factors: ${factors
        .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
        .slice(0, 3)
        .map((f) => `${f.description} (${f.points >= 0 ? "+" : ""}${f.points})`)
        .join("; ")}.`;
    }

    logger.info("auto-resolution.evaluated", {
      orderId,
      score,
      decision,
      factorCount: factors.length,
    });

    return {
      score,
      decision,
      factors,
      recommendation,
      coolingPeriodHours: canAutoResolve ? W.COOLING_PERIOD_HOURS : 0,
      canAutoResolve,
    };
  }

  /**
   * Queue an auto-resolution with a 24-hour cooling period.
   * The other party is notified and can submit counter-evidence.
   */
  async queueAutoResolution(orderId: string): Promise<DisputeEvaluation> {
    const evaluation = await this.evaluateDispute(orderId);

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        buyerId: true,
        sellerId: true,
        listing: { select: { title: true } },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    if (evaluation.canAutoResolve) {
      const executeAt = new Date(
        Date.now() + evaluation.coolingPeriodHours * 60 * 60 * 1000,
      );

      // Record the queued decision
      orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.AUTO_RESOLVED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: `Auto-resolution queued: ${evaluation.decision}. Executes in ${evaluation.coolingPeriodHours}h unless counter-evidence is provided.`,
        metadata: {
          decision: evaluation.decision,
          score: evaluation.score,
          factors: evaluation.factors,
          recommendation: evaluation.recommendation,
          executeAt: executeAt.toISOString(),
          status: "QUEUED",
        },
      });

      // Notify the party who would be adversely affected
      const affectedPartyId =
        evaluation.decision === "AUTO_REFUND" ? order.sellerId : order.buyerId;
      const outcomeText =
        evaluation.decision === "AUTO_REFUND"
          ? "resolved with a refund to the buyer"
          : "dismissed in the seller's favour";

      createNotification({
        userId: affectedPartyId,
        type: "ORDER_DISPUTED",
        title: "Dispute resolution pending",
        body: `Based on our review, this dispute will be ${outcomeText} in 24 hours unless you provide additional evidence.`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

      logger.info("auto-resolution.queued", {
        orderId,
        decision: evaluation.decision,
        executeAt: executeAt.toISOString(),
      });
    } else {
      // ESCALATE_HUMAN or FLAG_FRAUD — record evaluation for admin
      orderEventService.recordEvent({
        orderId,
        type:
          evaluation.decision === "FLAG_FRAUD"
            ? ORDER_EVENT_TYPES.FRAUD_FLAGGED
            : ORDER_EVENT_TYPES.DISPUTE_RESPONDED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: `Auto-resolution: ${evaluation.decision}. Score: ${evaluation.score}`,
        metadata: {
          decision: evaluation.decision,
          score: evaluation.score,
          factors: evaluation.factors,
          recommendation: evaluation.recommendation,
          status:
            evaluation.decision === "FLAG_FRAUD" ? "FLAGGED" : "ESCALATED",
        },
      });

      if (evaluation.decision === "FLAG_FRAUD") {
        audit({
          userId: null,
          action: "FRAUD_FLAGGED",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            trigger: "AUTO_RESOLUTION",
            score: evaluation.score,
            recommendation: evaluation.recommendation,
          },
        });
      }
    }

    return evaluation;
  }

  /**
   * Execute an auto-resolution decision (called after cooling period).
   */
  async executeDecision(
    orderId: string,
    evaluation: DisputeEvaluation,
  ): Promise<void> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        totalNzd: true,
        stripePaymentIntentId: true,
        listing: { select: { title: true, id: true } },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    if (evaluation.decision === "AUTO_REFUND") {
      // Refund via Stripe
      if (order.stripePaymentIntentId) {
        try {
          await paymentService.refundPayment({
            paymentIntentId: order.stripePaymentIntentId,
            orderId: order.id,
            reason: "Auto-resolved dispute: buyer refund",
          });
        } catch (err) {
          logger.error("auto-resolution.refund_failed", {
            orderId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      try {
        await transitionOrder(
          orderId,
          "REFUNDED",
          { disputeResolvedAt: new Date() },
          { fromStatus: "DISPUTED" },
        );
      } catch {
        logger.warn("auto-resolution.transition_failed", {
          orderId,
          target: "REFUNDED",
        });
      }

      // Restore listing
      if (order.listing) {
        await db.listing
          .updateMany({
            where: { id: order.listing.id, status: "SOLD" },
            data: { status: "ACTIVE" },
          })
          .catch(() => {});
      }

      orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.REFUNDED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: `Auto-resolved: Full refund to buyer. Score: ${evaluation.score}`,
        metadata: {
          decision: "AUTO_REFUND",
          score: evaluation.score,
          factors: evaluation.factors,
          status: "EXECUTED",
        },
      });

      createNotification({
        userId: order.buyerId,
        type: "SYSTEM",
        title: "Dispute resolved — refund issued",
        body: `Your dispute has been resolved in your favour. A full refund of $${(order.totalNzd / 100).toFixed(2)} is being processed.`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

      createNotification({
        userId: order.sellerId,
        type: "SYSTEM",
        title: "Dispute resolved — refund to buyer",
        body: `The dispute on "${order.listing?.title}" has been resolved with a refund to the buyer.`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

      audit({
        userId: null,
        action: "DISPUTE_RESOLVED",
        entityType: "Order",
        entityId: orderId,
        metadata: {
          trigger: "AUTO_RESOLUTION",
          decision: "AUTO_REFUND",
          score: evaluation.score,
        },
      });
    } else if (evaluation.decision === "AUTO_DISMISS") {
      try {
        await db.order.update({
          where: { id: orderId },
          data: { disputeResolvedAt: new Date() },
        });
        await transitionOrder(
          orderId,
          "COMPLETED",
          { completedAt: new Date() },
          { fromStatus: "DISPUTED" },
        );
      } catch {
        logger.warn("auto-resolution.dismiss_failed", { orderId });
      }

      if (order.stripePaymentIntentId) {
        try {
          await paymentService.capturePayment({
            paymentIntentId: order.stripePaymentIntentId,
            orderId: order.id,
          });
        } catch (err) {
          logger.warn("auto-resolution.capture_failed", {
            orderId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.DISPUTE_RESOLVED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: `Auto-resolved: Dismissed in seller's favour. Score: ${evaluation.score}`,
        metadata: {
          decision: "AUTO_DISMISS",
          score: evaluation.score,
          factors: evaluation.factors,
          status: "EXECUTED",
        },
      });

      createNotification({
        userId: order.buyerId,
        type: "SYSTEM",
        title: "Dispute resolved",
        body: "After review, the dispute has been resolved in the seller's favour. Payment will be released.",
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

      createNotification({
        userId: order.sellerId,
        type: "ORDER_COMPLETED",
        title: "Dispute resolved in your favour",
        body: `The dispute on "${order.listing?.title}" has been dismissed. Payment is being released.`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});

      audit({
        userId: null,
        action: "DISPUTE_RESOLVED",
        entityType: "Order",
        entityId: orderId,
        metadata: {
          trigger: "AUTO_RESOLUTION",
          decision: "AUTO_DISMISS",
          score: evaluation.score,
        },
      });
    } else if (evaluation.decision === "FLAG_FRAUD") {
      orderEventService.recordEvent({
        orderId,
        type: ORDER_EVENT_TYPES.FRAUD_FLAGGED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: `Fraud warning flagged. Score: ${evaluation.score}`,
        metadata: {
          decision: "FLAG_FRAUD",
          score: evaluation.score,
          factors: evaluation.factors,
          status: "FLAGGED",
        },
      });
      audit({
        userId: null,
        action: "FRAUD_FLAGGED",
        entityType: "Order",
        entityId: orderId,
        metadata: { trigger: "AUTO_RESOLUTION", score: evaluation.score },
      });
    }

    logger.info("auto-resolution.executed", {
      orderId,
      decision: evaluation.decision,
      score: evaluation.score,
    });
  }
}

export const autoResolutionService = new AutoResolutionService();
