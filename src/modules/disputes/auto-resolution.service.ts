// src/modules/disputes/auto-resolution.service.ts
// ─── Auto-Resolution Engine ────────────────────────────────────────────────
// Evaluates disputed orders and returns a recommendation:
//   AUTO_REFUND   — clear-cut buyer case, refund automatically
//   AUTO_DISMISS  — clear-cut seller case, dismiss dispute
//   ESCALATE_HUMAN — ambiguous, needs admin review
//   FLAG_FRAUD    — suspicious pattern detected, do not auto-resolve
//
// Evidence scoring: -100 (strongly favours seller) to +100 (strongly favours buyer).
// All decisions are logged with full reasoning for audit purposes.

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
  recommendation: string; // human-readable summary for admin panel
}

// ── Decision thresholds ───────────────────────────────────────────────────

const THRESHOLD_AUTO_REFUND = 60;
const THRESHOLD_AUTO_DISMISS = -40;
const FRAUD_BUYER_DISPUTES_30D = 5;
const FRAUD_SELLER_DISPUTE_RATE = 20; // percentage

// ── Service ───────────────────────────────────────────────────────────────

export class AutoResolutionService {
  /**
   * Evaluate a disputed order and return a resolution recommendation.
   * Does NOT execute any action — the caller decides what to do.
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

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const factors: EvidenceFactor[] = [];
    let score = 0;

    // ── Fetch trust metrics ─────────────────────────────────────────
    const [buyerMetrics, sellerMetrics] = await Promise.all([
      trustMetricsService.getBuyerMetrics(order.buyerId),
      trustMetricsService.getSellerMetrics(order.sellerId),
    ]);

    // ── Factors that favour buyer (increase score) ──────────────────

    // No tracking number
    if (!order.trackingNumber) {
      const pts = 30;
      score += pts;
      factors.push({
        factor: "NO_TRACKING",
        points: pts,
        description: "Seller did not provide a tracking number",
      });
    }

    // Tracking shows no movement after 7+ days (check dispatch date)
    if (order.dispatchedAt) {
      const daysSinceDispatch =
        (Date.now() - order.dispatchedAt.getTime()) / (1000 * 60 * 60 * 24);
      // If dispatched 7+ days ago and buyer hasn't confirmed delivery,
      // treat as "no movement" (we can't check courier APIs directly)
      if (daysSinceDispatch >= 7 && !order.completedAt) {
        const pts = 25;
        score += pts;
        factors.push({
          factor: "NO_TRACKING_MOVEMENT",
          points: pts,
          description: `Dispatched ${Math.floor(daysSinceDispatch)} days ago with no delivery confirmation`,
        });
      }
    }

    // No dispatch photos
    const dispatchEvent = await db.orderEvent.findFirst({
      where: { orderId, type: "DISPATCHED" },
      select: { metadata: true },
    });
    const dispatchMeta = (dispatchEvent?.metadata ?? {}) as Record<
      string,
      unknown
    >;
    if (
      !Array.isArray(dispatchMeta.dispatchPhotos) ||
      dispatchMeta.dispatchPhotos.length === 0
    ) {
      const pts = 20;
      score += pts;
      factors.push({
        factor: "NO_DISPATCH_PHOTOS",
        points: pts,
        description: "Seller did not upload dispatch evidence photos",
      });
    }

    // Seller didn't respond to dispute within 72 hours
    if (order.disputeOpenedAt && !order.sellerRespondedAt) {
      const hoursSinceDispute =
        (Date.now() - order.disputeOpenedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceDispute >= 72) {
        const pts = 25;
        score += pts;
        factors.push({
          factor: "SELLER_UNRESPONSIVE",
          points: pts,
          description: `Seller has not responded to dispute (${Math.floor(hoursSinceDispute)}h elapsed)`,
        });
      }
    }

    // Seller has high dispute rate (>15%)
    if (sellerMetrics.totalOrders >= 5 && sellerMetrics.disputeRate > 15) {
      const pts = 15;
      score += pts;
      factors.push({
        factor: "HIGH_SELLER_DISPUTE_RATE",
        points: pts,
        description: `Seller dispute rate: ${sellerMetrics.disputeRate}% (${sellerMetrics.disputeCount}/${sellerMetrics.totalOrders})`,
      });
    }

    // Buyer uploaded evidence photos
    if (order.disputeEvidenceUrls.length > 0) {
      const pts = 10;
      score += pts;
      factors.push({
        factor: "BUYER_EVIDENCE",
        points: pts,
        description: `Buyer uploaded ${order.disputeEvidenceUrls.length} evidence photo(s)`,
      });
    }

    // Buyer attempted to resolve with seller before filing (has interaction history)
    const priorInteractions = await db.orderInteraction.count({
      where: {
        orderId,
        initiatedById: order.buyerId,
        createdAt: { lt: order.disputeOpenedAt ?? new Date() },
      },
    });
    if (priorInteractions > 0) {
      const pts = 10;
      score += pts;
      factors.push({
        factor: "BUYER_ATTEMPTED_RESOLUTION",
        points: pts,
        description: `Buyer filed ${priorInteractions} interaction(s) before opening dispute`,
      });
    }

    // Previous interaction was rejected by seller without counter
    const rejectedInteraction = await db.orderInteraction.findFirst({
      where: {
        orderId,
        status: "REJECTED",
        responseById: order.sellerId,
      },
      orderBy: { createdAt: "desc" },
    });
    if (rejectedInteraction) {
      const pts = 10;
      score += pts;
      factors.push({
        factor: "SELLER_REJECTED_WITHOUT_COUNTER",
        points: pts,
        description:
          "Seller rejected buyer's previous request without counter-offer",
      });
    }

    // ── Factors that favour seller (decrease score) ─────────────────

    // Buyer confirmed delivery and item was "as described"
    const deliveryOkEvent = await db.orderEvent.findFirst({
      where: { orderId, type: "DELIVERY_CONFIRMED_OK" },
      select: { metadata: true },
    });
    if (deliveryOkEvent) {
      const pts = -30;
      score += pts;
      factors.push({
        factor: "BUYER_CONFIRMED_OK",
        points: pts,
        description: 'Buyer previously confirmed item arrived "as described"',
      });
    }

    // Tracking shows delivered (we check if order reached DELIVERED/COMPLETED)
    if (order.completedAt) {
      const pts = -25;
      score += pts;
      factors.push({
        factor: "TRACKING_DELIVERED",
        points: pts,
        description: "Order was marked as delivered/completed before dispute",
      });
    }

    // Seller uploaded dispatch photos
    if (
      Array.isArray(dispatchMeta.dispatchPhotos) &&
      dispatchMeta.dispatchPhotos.length > 0
    ) {
      const pts = -15;
      score += pts;
      factors.push({
        factor: "SELLER_DISPATCH_PHOTOS",
        points: pts,
        description: `Seller uploaded ${dispatchMeta.dispatchPhotos.length} dispatch evidence photo(s)`,
      });
    }

    // Seller responded to dispute with evidence
    if (order.sellerResponse) {
      const pts = -15;
      score += pts;
      factors.push({
        factor: "SELLER_RESPONDED",
        points: pts,
        description: "Seller provided a written response to the dispute",
      });
    }

    // Buyer has high dispute rate (>5 in 30 days)
    if (buyerMetrics.disputesLast30Days > 5) {
      const pts = -20;
      score += pts;
      factors.push({
        factor: "HIGH_BUYER_DISPUTE_RATE",
        points: pts,
        description: `Buyer has ${buyerMetrics.disputesLast30Days} disputes in the last 30 days`,
      });
    }

    // Dispute reason is "changed mind" or similar (OTHER reason with no strong claim)
    if (order.disputeReason === "OTHER") {
      const pts = -25;
      score += pts;
      factors.push({
        factor: "WEAK_DISPUTE_REASON",
        points: pts,
        description: `Dispute reason: "${order.disputeReason}" — no specific issue claimed`,
      });
    }

    // Seller has low dispute rate (<5%)
    if (sellerMetrics.totalOrders >= 5 && sellerMetrics.disputeRate < 5) {
      const pts = -10;
      score += pts;
      factors.push({
        factor: "LOW_SELLER_DISPUTE_RATE",
        points: pts,
        description: `Seller has excellent track record: ${sellerMetrics.disputeRate}% dispute rate`,
      });
    }

    // ── Decision ────────────────────────────────────────────────────

    // Fraud check takes priority
    if (
      buyerMetrics.disputesLast30Days > FRAUD_BUYER_DISPUTES_30D ||
      (sellerMetrics.totalOrders >= 5 &&
        sellerMetrics.disputeRate > FRAUD_SELLER_DISPUTE_RATE)
    ) {
      const flagTarget =
        buyerMetrics.disputesLast30Days > FRAUD_BUYER_DISPUTES_30D
          ? "buyer"
          : "seller";
      const recommendation = `FRAUD FLAG: ${flagTarget === "buyer" ? `Buyer has ${buyerMetrics.disputesLast30Days} disputes in 30 days` : `Seller dispute rate ${sellerMetrics.disputeRate}%`}. Score: ${score}. Requires manual review.`;

      logger.warn("auto-resolution.fraud_flagged", {
        orderId,
        score,
        flagTarget,
      });

      return {
        score,
        decision: "FLAG_FRAUD",
        factors,
        recommendation,
      };
    }

    let decision: AutoResolutionDecision;
    let recommendation: string;

    if (score >= THRESHOLD_AUTO_REFUND) {
      decision = "AUTO_REFUND";
      recommendation = `Auto-resolved: Refund buyer. Score: ${score >= 0 ? "+" : ""}${score}. Factors: ${factors
        .filter((f) => f.points > 0)
        .map((f) => f.description)
        .join("; ")}.`;
    } else if (score <= THRESHOLD_AUTO_DISMISS) {
      decision = "AUTO_DISMISS";
      recommendation = `Auto-resolved: Dismiss in seller's favour. Score: ${score}. Factors: ${factors
        .filter((f) => f.points < 0)
        .map((f) => f.description)
        .join("; ")}.`;
    } else {
      decision = "ESCALATE_HUMAN";
      recommendation = `Escalated for admin review. Score: ${score}. No clear resolution — evidence is mixed. Top factors: ${factors
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

    return { score, decision, factors, recommendation };
  }

  /**
   * Execute an auto-resolution decision.
   * AUTO_REFUND: transitions order to REFUNDED, initiates Stripe refund.
   * AUTO_DISMISS: resolves dispute in seller's favour, transitions to previous state.
   * FLAG_FRAUD: records fraud warning, no state change.
   * ESCALATE_HUMAN: no action, just records event.
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

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    switch (evaluation.decision) {
      case "AUTO_REFUND": {
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
            // Fall through — still record the event, admin can handle refund manually
          }
        }

        // Transition to REFUNDED
        try {
          await transitionOrder(
            orderId,
            "REFUNDED",
            {
              disputeResolvedAt: new Date(),
            },
            { fromStatus: "DISPUTED" },
          );
        } catch {
          // May already be in another state
          logger.warn("auto-resolution.transition_failed", {
            orderId,
            targetStatus: "REFUNDED",
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

        // Record event with full reasoning
        orderEventService.recordEvent({
          orderId,
          type: ORDER_EVENT_TYPES.AUTO_RESOLVED,
          actorId: null,
          actorRole: ACTOR_ROLES.SYSTEM,
          summary: `Auto-resolved: Full refund to buyer. Score: ${evaluation.score}`,
          metadata: {
            decision: evaluation.decision,
            score: evaluation.score,
            factors: evaluation.factors,
            recommendation: evaluation.recommendation,
          },
        });

        orderEventService.recordEvent({
          orderId,
          type: ORDER_EVENT_TYPES.REFUNDED,
          actorId: null,
          actorRole: ACTOR_ROLES.SYSTEM,
          summary: "Order refunded via auto-resolution engine",
        });

        // Notify both parties
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
          title: "Dispute resolved — refund issued to buyer",
          body: `The dispute on "${order.listing?.title ?? "your listing"}" has been resolved with a refund to the buyer.`,
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

        break;
      }

      case "AUTO_DISMISS": {
        // Resolve dispute in seller's favour — transition back to previous state
        try {
          await db.order.update({
            where: { id: orderId },
            data: { disputeResolvedAt: new Date() },
          });
          // Move from DISPUTED back to DISPATCHED or DELIVERED
          // Since we can't easily know the previous state, mark as COMPLETED
          // (escrow was already held, seller should be paid)
          await transitionOrder(
            orderId,
            "COMPLETED",
            { completedAt: new Date() },
            { fromStatus: "DISPUTED" },
          );
        } catch {
          logger.warn("auto-resolution.dismiss_transition_failed", { orderId });
        }

        // Capture payment for seller
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
          type: ORDER_EVENT_TYPES.AUTO_RESOLVED,
          actorId: null,
          actorRole: ACTOR_ROLES.SYSTEM,
          summary: `Auto-resolved: Dismissed in seller's favour. Score: ${evaluation.score}`,
          metadata: {
            decision: evaluation.decision,
            score: evaluation.score,
            factors: evaluation.factors,
            recommendation: evaluation.recommendation,
          },
        });

        orderEventService.recordEvent({
          orderId,
          type: ORDER_EVENT_TYPES.DISPUTE_RESOLVED,
          actorId: null,
          actorRole: ACTOR_ROLES.SYSTEM,
          summary: "Dispute dismissed — resolved in seller's favour",
        });

        createNotification({
          userId: order.buyerId,
          type: "SYSTEM",
          title: "Dispute resolved",
          body: "After review, the dispute has been resolved in the seller's favour. Payment will be released to the seller.",
          orderId,
          link: `/orders/${orderId}`,
        }).catch(() => {});

        createNotification({
          userId: order.sellerId,
          type: "ORDER_COMPLETED",
          title: "Dispute resolved in your favour",
          body: `The dispute on "${order.listing?.title ?? "your listing"}" has been dismissed. Payment is being released.`,
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

        break;
      }

      case "FLAG_FRAUD": {
        // Don't resolve — just flag for admin
        orderEventService.recordEvent({
          orderId,
          type: ORDER_EVENT_TYPES.FRAUD_FLAGGED,
          actorId: null,
          actorRole: ACTOR_ROLES.SYSTEM,
          summary: `Fraud warning flagged by auto-resolution engine. Score: ${evaluation.score}`,
          metadata: {
            decision: evaluation.decision,
            score: evaluation.score,
            factors: evaluation.factors,
            recommendation: evaluation.recommendation,
          },
        });

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

        break;
      }

      case "ESCALATE_HUMAN": {
        // Record event for admin visibility — no state change
        orderEventService.recordEvent({
          orderId,
          type: ORDER_EVENT_TYPES.DISPUTE_RESPONDED,
          actorId: null,
          actorRole: ACTOR_ROLES.SYSTEM,
          summary: `Auto-resolution: Escalated for admin review. Score: ${evaluation.score}`,
          metadata: {
            decision: evaluation.decision,
            score: evaluation.score,
            factors: evaluation.factors,
            recommendation: evaluation.recommendation,
          },
        });

        break;
      }
    }

    logger.info("auto-resolution.executed", {
      orderId,
      decision: evaluation.decision,
      score: evaluation.score,
    });
  }
}

export const autoResolutionService = new AutoResolutionService();
