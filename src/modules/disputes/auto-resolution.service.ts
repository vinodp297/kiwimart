// src/modules/disputes/auto-resolution.service.ts
// ─── Auto-Resolution Engine ────────────────────────────────────────────────
// Evaluates disputed orders using evidence scoring and returns a recommendation.
// Supports a 24-hour cooling period before execution so the other party can
// submit counter-evidence.

import { orderRepository } from "@/modules/orders/order.repository";
import { formatCentsAsNzd } from "@/lib/currency";
import { interactionRepository } from "@/modules/orders/interaction.repository";
import { listingRepository } from "@/modules/listings/listing.repository";
import { userRepository } from "@/modules/users/user.repository";
import { CONFIG_KEYS, getConfigMany } from "@/lib/platform-config";
import type { ConfigKey } from "@/lib/platform-config";
import { MS_PER_HOUR, MS_PER_DAY } from "@/lib/time";
import { logger } from "@/shared/logger";
import { paymentService } from "@/modules/payments/payment.service";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { createNotification } from "@/modules/notifications/notification.service";
import { fireAndForget } from "@/lib/fire-and-forget";
import { sendDisputeResolvedEmail } from "@/server/email";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { trustMetricsService } from "@/modules/trust/trust-metrics.service";
import { audit } from "@/server/lib/audit";
import {
  getDisputeByOrderId,
  resolveDispute as resolveDisputeRecord,
  setAutoResolving,
} from "@/server/services/dispute/dispute.service";
import { withLock } from "@/server/lib/distributedLock";

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
    const order = await orderRepository.findForAutoResolutionEvaluate(orderId);

    if (!order) throw new Error(`Order ${orderId} not found`);

    // Fetch dispute data from Dispute model
    const dispute = await getDisputeByOrderId(orderId);
    if (!dispute) throw new Error(`No dispute found for order ${orderId}`);

    // Extract dispute fields from the Dispute model
    const disputeReason = dispute.reason;
    const disputeOpenedAt = dispute.openedAt;
    const sellerResponse = dispute.sellerStatement;
    const sellerRespondedAt = dispute.sellerRespondedAt;
    const buyerEvidenceCount = dispute.evidence.filter(
      (e) => e.uploadedBy === "BUYER",
    ).length;

    const factors: EvidenceFactor[] = [];
    let score = 0;
    const W = RESOLUTION_WEIGHTS;

    // ── Load platform config ──────────────────────────────────────────
    const config = await getConfigMany([
      CONFIG_KEYS.AUTO_REFUND_SCORE_THRESHOLD,
      CONFIG_KEYS.AUTO_DISMISS_SCORE_THRESHOLD,
      CONFIG_KEYS.BUYER_FRAUD_DISPUTE_LIMIT,
      CONFIG_KEYS.SELLER_FRAUD_DISPUTE_RATE_PCT,
      CONFIG_KEYS.BUYER_HUMAN_REVIEW_AFTER,
      CONFIG_KEYS.DISPUTE_COOLING_PERIOD_HOURS,
      CONFIG_KEYS.DISPUTE_SELLER_UNRESPONSIVE_HOURS,
      CONFIG_KEYS.DISPUTE_SELLER_HIGH_RATE_PCT,
      CONFIG_KEYS.DISPUTE_SELLER_HIGH_RATE_MIN_ORDERS,
      CONFIG_KEYS.DISPUTE_BUYER_HIGH_DISPUTES_DAYS,
      CONFIG_KEYS.DISPUTE_BUYER_HIGH_DISPUTES_COUNT,
      CONFIG_KEYS.DISPUTE_SELLER_LOW_RATE_PCT,
      CONFIG_KEYS.DISPUTE_SELLER_LOW_RATE_MIN_ORDERS,
    ]);

    const cfgInt = (k: ConfigKey, fallback: number) =>
      parseInt(config.get(k) ?? String(fallback), 10);
    const cfgFloat = (k: ConfigKey, fallback: number) =>
      parseFloat(config.get(k) ?? String(fallback));

    const autoRefundThreshold = cfgInt(
      CONFIG_KEYS.AUTO_REFUND_SCORE_THRESHOLD,
      60,
    );
    const autoDismissThreshold = cfgInt(
      CONFIG_KEYS.AUTO_DISMISS_SCORE_THRESHOLD,
      -40,
    );
    const buyerFraudDisputeLimit = cfgInt(
      CONFIG_KEYS.BUYER_FRAUD_DISPUTE_LIMIT,
      5,
    );
    const sellerFraudDisputeRatePct = cfgFloat(
      CONFIG_KEYS.SELLER_FRAUD_DISPUTE_RATE_PCT,
      20,
    );
    const buyerHumanReviewAfter = cfgInt(
      CONFIG_KEYS.BUYER_HUMAN_REVIEW_AFTER,
      3,
    );
    const coolingPeriodHours = cfgInt(
      CONFIG_KEYS.DISPUTE_COOLING_PERIOD_HOURS,
      24,
    );
    const sellerUnresponsiveHours = cfgInt(
      CONFIG_KEYS.DISPUTE_SELLER_UNRESPONSIVE_HOURS,
      72,
    );
    const sellerHighRatePct = cfgInt(
      CONFIG_KEYS.DISPUTE_SELLER_HIGH_RATE_PCT,
      15,
    );
    const sellerHighRateMinOrders = cfgInt(
      CONFIG_KEYS.DISPUTE_SELLER_HIGH_RATE_MIN_ORDERS,
      5,
    );
    const buyerHighDisputesDays = cfgInt(
      CONFIG_KEYS.DISPUTE_BUYER_HIGH_DISPUTES_DAYS,
      30,
    );
    const buyerHighDisputesCount = cfgInt(
      CONFIG_KEYS.DISPUTE_BUYER_HIGH_DISPUTES_COUNT,
      5,
    );
    const sellerLowRatePct = cfgInt(CONFIG_KEYS.DISPUTE_SELLER_LOW_RATE_PCT, 5);
    const sellerLowRateMinOrders = cfgInt(
      CONFIG_KEYS.DISPUTE_SELLER_LOW_RATE_MIN_ORDERS,
      5,
    );

    // Fetch trust metrics
    const [buyerMetrics, sellerMetrics] = await Promise.all([
      trustMetricsService.getBuyerMetrics(order.buyerId),
      trustMetricsService.getSellerMetrics(order.sellerId),
    ]);

    // ── Rate limiting check ─────────────────────────────────────────
    if (buyerMetrics.disputesLast30Days > buyerHumanReviewAfter) {
      return {
        score: 0,
        decision: "ESCALATE_HUMAN",
        factors: [
          {
            factor: "BUYER_DISPUTE_RATE_LIMITED",
            points: 0,
            description: `Buyer has ${buyerMetrics.disputesLast30Days} disputes in ${buyerHighDisputesDays} days — auto-resolution skipped, requires human review`,
          },
        ],
        recommendation: `Escalated: Buyer exceeded auto-resolution threshold (${buyerMetrics.disputesLast30Days} disputes in ${buyerHighDisputesDays} days).`,
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
        (Date.now() - order.dispatchedAt.getTime()) / MS_PER_DAY;
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
    const dispatchEvent = await orderRepository.findDispatchEvent(orderId);
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

    if (disputeOpenedAt && !sellerRespondedAt) {
      const hoursSinceDispute =
        (Date.now() - disputeOpenedAt.getTime()) / MS_PER_HOUR;
      if (hoursSinceDispute >= sellerUnresponsiveHours) {
        score += W.SELLER_UNRESPONSIVE_72H;
        factors.push({
          factor: "SELLER_UNRESPONSIVE_72H",
          points: W.SELLER_UNRESPONSIVE_72H,
          description: `Seller has not responded (${Math.floor(hoursSinceDispute)}h elapsed)`,
        });
      }
    }

    if (
      sellerMetrics.totalOrders >= sellerHighRateMinOrders &&
      sellerMetrics.disputeRate > sellerHighRatePct
    ) {
      score += W.SELLER_HIGH_DISPUTE_RATE;
      factors.push({
        factor: "SELLER_HIGH_DISPUTE_RATE",
        points: W.SELLER_HIGH_DISPUTE_RATE,
        description: `Seller dispute rate: ${sellerMetrics.disputeRate}%`,
      });
    }

    if (buyerEvidenceCount > 0) {
      score += W.BUYER_UPLOADED_EVIDENCE;
      factors.push({
        factor: "BUYER_UPLOADED_EVIDENCE",
        points: W.BUYER_UPLOADED_EVIDENCE,
        description: `Buyer uploaded ${buyerEvidenceCount} evidence photo(s)`,
      });
    }

    const priorInteractions =
      await interactionRepository.countPriorBuyerInteractions(
        orderId,
        order.buyerId,
        disputeOpenedAt ?? new Date(),
      );
    if (priorInteractions > 0) {
      score += W.BUYER_ATTEMPTED_RESOLUTION;
      factors.push({
        factor: "BUYER_ATTEMPTED_RESOLUTION",
        points: W.BUYER_ATTEMPTED_RESOLUTION,
        description: `Buyer filed ${priorInteractions} interaction(s) before opening dispute`,
      });
    }

    const rejectedInteraction =
      await interactionRepository.findRejectedByResponder(
        orderId,
        order.sellerId,
      );
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

    const deliveryOkEvent = await orderRepository.findDeliveryOkEvent(orderId);
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

    if (sellerResponse) {
      score += W.SELLER_RESPONDED_WITH_EVIDENCE;
      factors.push({
        factor: "SELLER_RESPONDED_WITH_EVIDENCE",
        points: W.SELLER_RESPONDED_WITH_EVIDENCE,
        description: "Seller provided a written response to the dispute",
      });
    }

    if (buyerMetrics.disputesLast30Days > buyerHighDisputesCount) {
      score += W.BUYER_HIGH_DISPUTE_RATE;
      factors.push({
        factor: "BUYER_HIGH_DISPUTE_RATE",
        points: W.BUYER_HIGH_DISPUTE_RATE,
        description: `Buyer has ${buyerMetrics.disputesLast30Days} disputes in the last ${buyerHighDisputesDays} days`,
      });
    }

    if (disputeReason === "OTHER") {
      score += W.DISPUTE_IS_CHANGE_OF_MIND;
      factors.push({
        factor: "DISPUTE_IS_CHANGE_OF_MIND",
        points: W.DISPUTE_IS_CHANGE_OF_MIND,
        description: `Dispute reason: "${disputeReason}" — no specific issue`,
      });
    }

    if (
      sellerMetrics.totalOrders >= sellerLowRateMinOrders &&
      sellerMetrics.disputeRate < sellerLowRatePct
    ) {
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
      (disputeReason === "ITEM_NOT_AS_DESCRIBED" ||
        disputeReason === "ITEM_DAMAGED")
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
        recommendation: `Escalated: Dispatch photos exist but buyer claims ${disputeReason.replace(/_/g, " ").toLowerCase()}. Score: ${score}. Needs human comparison.`,
        coolingPeriodHours: 0,
        canAutoResolve: false,
      };
    }

    // ── Fraud check ─────────────────────────────────────────────────
    if (
      buyerMetrics.disputesLast30Days > buyerFraudDisputeLimit ||
      (sellerMetrics.totalOrders >= sellerHighRateMinOrders &&
        sellerMetrics.disputeRate / 100 > sellerFraudDisputeRatePct / 100)
    ) {
      const flagTarget =
        buyerMetrics.disputesLast30Days > buyerFraudDisputeLimit
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

    if (score >= autoRefundThreshold) {
      decision = "AUTO_REFUND";
      canAutoResolve = true;
      recommendation = `Auto-refund recommended. Score: +${score}. Key factors: ${factors
        .filter((f) => f.points > 0)
        .map((f) => f.description)
        .join("; ")}.`;
    } else if (score <= autoDismissThreshold) {
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
      coolingPeriodHours: canAutoResolve ? coolingPeriodHours : 0,
      canAutoResolve,
    };
  }

  /**
   * Queue an auto-resolution with a 24-hour cooling period.
   * The other party is notified and can submit counter-evidence.
   */
  async queueAutoResolution(orderId: string): Promise<DisputeEvaluation> {
    const evaluation = await this.evaluateDispute(orderId);

    const order = await orderRepository.findForAutoResolutionExecute(orderId);

    if (!order) throw new Error(`Order ${orderId} not found`);

    if (evaluation.canAutoResolve) {
      const executeAt = new Date(
        Date.now() + evaluation.coolingPeriodHours * MS_PER_HOUR,
      );

      // Update dispute status to AUTO_RESOLVING
      const dispute = await getDisputeByOrderId(orderId);
      if (dispute) {
        fireAndForget(
          setAutoResolving(
            dispute.id,
            evaluation.score,
            evaluation.recommendation,
          ),
          "autoResolution.setAutoResolving",
          { orderId, disputeId: dispute.id },
        );
      }

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

      fireAndForget(
        createNotification({
          userId: affectedPartyId,
          type: "ORDER_DISPUTED",
          title: "Dispute resolution pending",
          body: `Based on our review, this dispute will be ${outcomeText} in ${evaluation.coolingPeriodHours} hours unless you provide additional evidence.`,
          orderId,
          link: `/orders/${orderId}`,
        }),
        "autoResolution.queued.notify",
        { orderId, userId: affectedPartyId },
      );

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
    const order = await orderRepository.findForAutoResolutionExecute(orderId);

    if (!order) throw new Error(`Order ${orderId} not found`);

    // Fetch dispute record before acquiring the lock so we have its ID for
    // the lock key. The record is re-fetched INSIDE the lock to verify status.
    const disputeForLock = await getDisputeByOrderId(orderId);
    const lockKey = disputeForLock
      ? `dispute:${disputeForLock.id}`
      : `dispute:order:${orderId}`;

    await withLock(
      lockKey,
      async () => {
        // Re-fetch inside the lock — an admin or another worker may have
        // already resolved this dispute between queueing and execution.
        const dispute = await getDisputeByOrderId(orderId);

        if (
          disputeForLock &&
          (!dispute || dispute.status !== "AUTO_RESOLVING")
        ) {
          logger.info("dispute.auto_resolve.skipped", {
            disputeId: disputeForLock.id,
            currentStatus: dispute?.status ?? "not_found",
            orderId,
          });
          return;
        }

        if (evaluation.decision === "AUTO_REFUND") {
          // Stripe refund FIRST — never mark REFUNDED unless money actually moved.
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

              // Refund failed — keep order in DISPUTED for manual review.
              // Do NOT transition to REFUNDED.
              orderEventService.recordEvent({
                orderId,
                type: ORDER_EVENT_TYPES.DISPUTE_RESPONDED,
                actorId: null,
                actorRole: ACTOR_ROLES.SYSTEM,
                summary:
                  "Auto-resolution refund failed — order flagged for manual review",
                metadata: {
                  decision: "AUTO_REFUND",
                  error: err instanceof Error ? err.message : String(err),
                  status: "REFUND_FAILED",
                },
              });
              return;
            }
          }

          try {
            await orderRepository.$transaction(async (tx) => {
              await transitionOrder(
                orderId,
                "REFUNDED",
                {},
                { tx, fromStatus: "DISPUTED" },
              );
              if (dispute) {
                await resolveDisputeRecord({
                  disputeId: dispute.id,
                  decision: "BUYER_WON",
                  resolvedBy: "SYSTEM",
                  tx,
                });
              }

              // CRITICAL: audit and event inside the transaction so they roll back
              // atomically if the transition or dispute resolution fails.
              await orderEventService.recordEvent({
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
                tx,
              });

              await audit({
                userId: null,
                action: "DISPUTE_RESOLVED",
                entityType: "Order",
                entityId: orderId,
                metadata: {
                  trigger: "AUTO_RESOLUTION",
                  decision: "AUTO_REFUND",
                  score: evaluation.score,
                },
                tx,
              });
            });
          } catch {
            logger.warn("auto-resolution.transition_failed", {
              orderId,
              target: "REFUNDED",
            });
          }

          // Restore listing
          if (order.listing) {
            fireAndForget(
              listingRepository.restoreFromSold(order.listing.id),
              "autoResolution.restoreFromSold",
              { orderId, listingId: order.listing.id },
            );
          }

          fireAndForget(
            createNotification({
              userId: order.buyerId,
              type: "SYSTEM",
              title: "Dispute resolved — refund issued",
              body: `Your dispute has been resolved in your favour. A full refund of ${formatCentsAsNzd(order.totalNzd)} is being processed.`,
              orderId,
              link: `/orders/${orderId}`,
            }),
            "autoResolution.refund.notify.buyer",
            { orderId, userId: order.buyerId },
          );

          fireAndForget(
            createNotification({
              userId: order.sellerId,
              type: "SYSTEM",
              title: "Dispute resolved — refund to buyer",
              body: `The dispute on "${order.listing?.title}" has been resolved with a refund to the buyer.`,
              orderId,
              link: `/orders/${orderId}`,
            }),
            "autoResolution.refund.notify.seller",
            { orderId, userId: order.sellerId },
          );

          // Fire-and-forget AUTO_REFUND emails to both parties
          fireAndForget(
            userRepository
              .findManyEmailContactsByIds([order.buyerId, order.sellerId])
              .then((users) => {
                const buyer = users.find((u) => u.id === order.buyerId);
                const seller = users.find((u) => u.id === order.sellerId);
                if (buyer) {
                  fireAndForget(
                    sendDisputeResolvedEmail({
                      to: buyer.email,
                      recipientName: buyer.displayName ?? "there",
                      recipientRole: "buyer",
                      orderId,
                      listingTitle: order.listing?.title ?? "your item",
                      resolution: "BUYER_WON",
                      refundAmount: order.totalNzd,
                      adminNote: null,
                    }),
                    "autoResolution.refund.email.buyer",
                    { orderId },
                  );
                }
                if (seller) {
                  fireAndForget(
                    sendDisputeResolvedEmail({
                      to: seller.email,
                      recipientName: seller.displayName ?? "there",
                      recipientRole: "seller",
                      orderId,
                      listingTitle: order.listing?.title ?? "your item",
                      resolution: "BUYER_WON",
                      refundAmount: null,
                      adminNote: null,
                    }),
                    "autoResolution.refund.email.seller",
                    { orderId },
                  );
                }
              }),
            "autoResolution.refund.emailLookup",
            { orderId },
          );
        } else if (evaluation.decision === "AUTO_DISMISS") {
          // Stripe capture FIRST — never mark COMPLETED unless money actually moved.
          if (order.stripePaymentIntentId) {
            try {
              await paymentService.capturePayment({
                paymentIntentId: order.stripePaymentIntentId,
                orderId: order.id,
              });
            } catch (err) {
              logger.error("auto-resolution.capture_failed", {
                orderId,
                error: err instanceof Error ? err.message : String(err),
              });

              // Capture failed — keep order in DISPUTED for manual review.
              // Do NOT transition to COMPLETED.
              orderEventService.recordEvent({
                orderId,
                type: ORDER_EVENT_TYPES.DISPUTE_RESPONDED,
                actorId: null,
                actorRole: ACTOR_ROLES.SYSTEM,
                summary:
                  "Auto-resolution capture failed — order flagged for manual review",
                metadata: {
                  decision: "AUTO_DISMISS",
                  error: err instanceof Error ? err.message : String(err),
                  status: "CAPTURE_FAILED",
                },
              });
              return;
            }
          }

          try {
            await orderRepository.$transaction(async (tx) => {
              await transitionOrder(
                orderId,
                "COMPLETED",
                { completedAt: new Date() },
                { tx, fromStatus: "DISPUTED" },
              );
              if (dispute) {
                await resolveDisputeRecord({
                  disputeId: dispute.id,
                  decision: "SELLER_WON",
                  resolvedBy: "SYSTEM",
                  tx,
                });
              }

              // CRITICAL: audit and event inside the transaction so they roll back
              // atomically if the transition or dispute resolution fails.
              await orderEventService.recordEvent({
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
                tx,
              });

              await audit({
                userId: null,
                action: "DISPUTE_RESOLVED",
                entityType: "Order",
                entityId: orderId,
                metadata: {
                  trigger: "AUTO_RESOLUTION",
                  decision: "AUTO_DISMISS",
                  score: evaluation.score,
                },
                tx,
              });
            });
          } catch {
            logger.warn("auto-resolution.dismiss_failed", { orderId });
          }

          fireAndForget(
            createNotification({
              userId: order.buyerId,
              type: "SYSTEM",
              title: "Dispute resolved",
              body: "After review, the dispute has been resolved in the seller's favour. Payment will be released.",
              orderId,
              link: `/orders/${orderId}`,
            }),
            "autoResolution.dismiss.notify.buyer",
            { orderId, userId: order.buyerId },
          );

          fireAndForget(
            createNotification({
              userId: order.sellerId,
              type: "ORDER_COMPLETED",
              title: "Dispute resolved in your favour",
              body: `The dispute on "${order.listing?.title}" has been dismissed. Payment is being released.`,
              orderId,
              link: `/orders/${orderId}`,
            }),
            "autoResolution.dismiss.notify.seller",
            { orderId, userId: order.sellerId },
          );

          // Fire-and-forget AUTO_DISMISS emails to both parties
          fireAndForget(
            userRepository
              .findManyEmailContactsByIds([order.buyerId, order.sellerId])
              .then((users) => {
                const buyer = users.find((u) => u.id === order.buyerId);
                const seller = users.find((u) => u.id === order.sellerId);
                if (buyer) {
                  fireAndForget(
                    sendDisputeResolvedEmail({
                      to: buyer.email,
                      recipientName: buyer.displayName ?? "there",
                      recipientRole: "buyer",
                      orderId,
                      listingTitle: order.listing?.title ?? "your item",
                      resolution: "SELLER_WON",
                      refundAmount: null,
                      adminNote: null,
                    }),
                    "autoResolution.dismiss.email.buyer",
                    { orderId },
                  );
                }
                if (seller) {
                  fireAndForget(
                    sendDisputeResolvedEmail({
                      to: seller.email,
                      recipientName: seller.displayName ?? "there",
                      recipientRole: "seller",
                      orderId,
                      listingTitle: order.listing?.title ?? "your item",
                      resolution: "SELLER_WON",
                      refundAmount: null,
                      adminNote: null,
                    }),
                    "autoResolution.dismiss.email.seller",
                    { orderId },
                  );
                }
              }),
            "autoResolution.dismiss.emailLookup",
            { orderId },
          );
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
      },
      { ttlSeconds: 120 },
    ); // end withLock
  }
}

export const autoResolutionService = new AutoResolutionService();
