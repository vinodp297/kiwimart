// src/server/jobs/disputeAutoResolve.ts
// ─── Dispute Auto-Resolution Job ───────────────────────────────────────────
// Runs daily at 3:00 AM UTC via /api/cron/dispute-auto-resolve.
//
// 1. Process queued auto-resolutions past their 24h cooling period
// 2. Re-evaluate unresponsive disputes (seller no response after 72h)
// 3. Escalate expired OrderInteractions to disputes

import db from "@/lib/db";
import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import {
  autoResolutionService,
  RESOLUTION_WEIGHTS,
} from "@/modules/disputes/auto-resolution.service";
import { orderService } from "@/modules/orders/order.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { createNotification } from "@/modules/notifications/notification.service";
import { fireAndForget } from "@/lib/fire-and-forget";

export async function processDisputeAutoResolution(): Promise<{
  coolingExecuted: number;
  unresponsiveEvaluated: number;
  interactionsEscalated: number;
  errors: number;
}> {
  return runWithRequestContext(
    { correlationId: `cron:processDisputeAutoResolution:${Date.now()}` },
    async () => {
      let coolingExecuted = 0;
      let unresponsiveEvaluated = 0;
      let interactionsEscalated = 0;
      let errors = 0;

      // ── 1. Process queued auto-resolutions past cooling period ────────
      try {
        const queuedEvents = await db.orderEvent.findMany({
          where: {
            type: "AUTO_RESOLVED",
            metadata: { path: ["status"], equals: "QUEUED" },
          },
          take: 100,
          orderBy: { createdAt: "asc" },
          select: { id: true, orderId: true, metadata: true, createdAt: true },
        });

        // ── Bulk-fetch order statuses and counter-evidence (eliminates N+1) ──
        const queuedOrderIds = [...new Set(queuedEvents.map((e) => e.orderId))];
        const [queuedOrders, counterEvidenceEvents] = await Promise.all([
          db.order.findMany({
            where: { id: { in: queuedOrderIds } },
            select: { id: true, status: true },
          }),
          db.orderEvent.findMany({
            where: {
              orderId: { in: queuedOrderIds },
              type: "DISPUTE_RESPONDED",
            },
            select: { orderId: true, createdAt: true },
          }),
        ]);
        const orderStatusMap = new Map(
          queuedOrders.map((o) => [o.id, o.status]),
        );
        const counterEvidenceByOrder = new Map<string, Date[]>();
        for (const ce of counterEvidenceEvents) {
          if (!counterEvidenceByOrder.has(ce.orderId))
            counterEvidenceByOrder.set(ce.orderId, []);
          counterEvidenceByOrder.get(ce.orderId)!.push(ce.createdAt);
        }

        for (const event of queuedEvents) {
          try {
            const meta = (event.metadata ?? {}) as Record<string, unknown>;
            const executeAt = meta.executeAt
              ? new Date(meta.executeAt as string)
              : new Date(
                  event.createdAt.getTime() +
                    RESOLUTION_WEIGHTS.COOLING_PERIOD_HOURS * 60 * 60 * 1000,
                );

            // Not past cooling period yet
            if (executeAt.getTime() > Date.now()) continue;

            // Check if order is still disputed (from bulk-fetched data)
            const orderStatus = orderStatusMap.get(event.orderId);
            if (!orderStatus || orderStatus !== "DISPUTED") {
              // Already resolved by other means — mark event as superseded
              await db.orderEvent.update({
                where: { id: event.id },
                data: {
                  metadata: { ...(meta as object), status: "SUPERSEDED" },
                },
              });
              continue;
            }

            // Check for counter-evidence submitted during cooling (from bulk-fetched data)
            const counterDates =
              counterEvidenceByOrder.get(event.orderId) ?? [];
            const hasCounterEvidence = counterDates.some(
              (d) => d.getTime() > event.createdAt.getTime(),
            );

            if (hasCounterEvidence) {
              // Re-evaluate with new evidence
              const reEval = await autoResolutionService.evaluateDispute(
                event.orderId,
              );

              // Update the queued event metadata
              await db.orderEvent.update({
                where: { id: event.id },
                data: {
                  metadata: {
                    ...(meta as object),
                    status: "RE_EVALUATED",
                    newDecision: reEval.decision,
                    newScore: reEval.score,
                  },
                },
              });

              if (reEval.canAutoResolve) {
                await autoResolutionService.executeDecision(
                  event.orderId,
                  reEval,
                );
                coolingExecuted++;
              }
              // If re-evaluation changed to ESCALATE_HUMAN, leave for admin
            } else {
              // No counter-evidence — execute original decision
              const originalDecision = meta.decision as string;
              const originalScore = meta.score as number;
              const originalFactors = meta.factors as Array<{
                factor: string;
                points: number;
                description: string;
              }>;

              await autoResolutionService.executeDecision(event.orderId, {
                score: originalScore,
                decision: originalDecision as "AUTO_REFUND" | "AUTO_DISMISS",
                factors: originalFactors ?? [],
                recommendation: (meta.recommendation as string) ?? "",
                coolingPeriodHours: 0,
                canAutoResolve: true,
              });

              // Mark queued event as executed
              await db.orderEvent.update({
                where: { id: event.id },
                data: {
                  metadata: { ...(meta as object), status: "EXECUTED" },
                },
              });

              coolingExecuted++;
            }
          } catch (err) {
            errors++;
            logger.error("dispute.cooling.failed", {
              eventId: event.id,
              orderId: event.orderId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        logger.error("dispute.cooling.query_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ── 2. Re-evaluate unresponsive disputes (72h+) ──────────────────
      try {
        const sellerResponseHours = await getConfigInt(
          CONFIG_KEYS.DISPUTE_SELLER_RESPONSE_HOURS,
        );
        const responseDeadline = new Date(
          Date.now() - sellerResponseHours * 60 * 60 * 1000,
        );

        const unresponsive = await db.order.findMany({
          where: {
            status: "DISPUTED",
            dispute: {
              openedAt: { lte: responseDeadline },
              sellerRespondedAt: null,
              resolvedAt: null,
            },
          },
          take: 100,
          orderBy: { dispute: { openedAt: "asc" } },
          select: { id: true },
        });

        // ── Bulk-fetch already-queued events to avoid per-dispute DB calls ──
        const unresponsiveIds = unresponsive.map((d) => d.id);
        const alreadyQueuedEvents = await db.orderEvent.findMany({
          where: {
            orderId: { in: unresponsiveIds },
            type: "AUTO_RESOLVED",
            metadata: { path: ["status"], equals: "QUEUED" },
          },
          select: { orderId: true },
        });
        const alreadyQueuedSet = new Set(
          alreadyQueuedEvents.map((e) => e.orderId),
        );

        const unresponsiveResults = await Promise.allSettled(
          unresponsive
            .filter((dispute) => !alreadyQueuedSet.has(dispute.id))
            .map(async (dispute) => {
              await autoResolutionService.queueAutoResolution(dispute.id);
              return dispute.id;
            }),
        );

        for (const result of unresponsiveResults) {
          if (result.status === "fulfilled") {
            unresponsiveEvaluated++;
          } else {
            errors++;
            logger.error("dispute.unresponsive.failed", {
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            });
          }
        }
      } catch (err) {
        logger.error("dispute.unresponsive.query_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ── 3. Escalate expired OrderInteractions ────────────────────────
      try {
        const now = new Date();

        const expiredInteractions = await db.orderInteraction.findMany({
          where: {
            status: "PENDING",
            expiresAt: { lte: now },
            autoAction: "AUTO_ESCALATE",
          },
          take: 100,
          include: {
            order: {
              select: {
                id: true,
                buyerId: true,
                sellerId: true,
                status: true,
                listing: { select: { title: true } },
              },
            },
            initiator: { select: { displayName: true } },
          },
        });

        // ── Bulk-mark all expired interactions as ESCALATED ──
        const interactionIds = expiredInteractions.map((i) => i.id);
        if (interactionIds.length > 0) {
          await db.orderInteraction.updateMany({
            where: { id: { in: interactionIds } },
            data: { status: "ESCALATED", resolvedAt: now },
          });
        }

        const reasonMap: Record<string, string> = {
          DELIVERY_ISSUE: "ITEM_DAMAGED",
          RETURN_REQUEST: "ITEM_NOT_AS_DESCRIBED",
          PARTIAL_REFUND_REQUEST: "OTHER",
        };

        const escalationResults = await Promise.allSettled(
          expiredInteractions.map(async (interaction) => {
            // Record event (fire-and-forget style, but we await for ordering)
            orderEventService.recordEvent({
              orderId: interaction.orderId,
              type: ORDER_EVENT_TYPES.INTERACTION_EXPIRED,
              actorId: null,
              actorRole: ACTOR_ROLES.SYSTEM,
              summary: `${interaction.type.replace(/_/g, " ").toLowerCase()} expired and was escalated — no response received`,
              metadata: {
                interactionId: interaction.id,
                type: interaction.type,
                autoAction: interaction.autoAction,
              },
            });

            // For DELIVERY_ISSUE / RETURN_REQUEST / PARTIAL_REFUND: auto-open dispute
            const shouldAutoDispute =
              [
                "DELIVERY_ISSUE",
                "RETURN_REQUEST",
                "PARTIAL_REFUND_REQUEST",
              ].includes(interaction.type) &&
              interaction.order.status !== "DISPUTED";

            if (shouldAutoDispute) {
              try {
                await orderService.openDispute(
                  {
                    orderId: interaction.orderId,
                    reason: (reasonMap[interaction.type] ?? "OTHER") as
                      | "ITEM_DAMAGED"
                      | "ITEM_NOT_AS_DESCRIBED"
                      | "OTHER",
                    description: `Auto-escalated from ${interaction.type.replace(/_/g, " ").toLowerCase()}: ${interaction.reason}`,
                    evidenceUrls: [],
                  },
                  interaction.order.buyerId,
                  "system",
                );

                await autoResolutionService.queueAutoResolution(
                  interaction.orderId,
                );
              } catch (err) {
                logger.warn("dispute.escalation.open_failed", {
                  orderId: interaction.orderId,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }

            // Notify both parties (fire-and-forget)
            fireAndForget(
              createNotification({
                userId: interaction.order.buyerId,
                type: "ORDER_DISPUTED",
                title: "Request escalated",
                body: `Your ${interaction.type.replace(/_/g, " ").toLowerCase()} for "${interaction.order.listing.title}" was not responded to in time and has been escalated.`,
                orderId: interaction.orderId,
                link: `/orders/${interaction.orderId}`,
              }),
              "dispute.notification.escalated.buyer",
              { orderId: interaction.orderId },
            );

            fireAndForget(
              createNotification({
                userId: interaction.order.sellerId,
                type: "ORDER_DISPUTED",
                title: "Request escalated",
                body: `A ${interaction.type.replace(/_/g, " ").toLowerCase()} for "${interaction.order.listing.title}" has been escalated due to no response.`,
                orderId: interaction.orderId,
                link: `/orders/${interaction.orderId}`,
              }),
              "dispute.notification.escalated.seller",
              { orderId: interaction.orderId },
            );
          }),
        );

        for (const result of escalationResults) {
          if (result.status === "fulfilled") {
            interactionsEscalated++;
          } else {
            errors++;
            logger.error("dispute.escalation.failed", {
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            });
          }
        }
      } catch (err) {
        logger.error("dispute.escalation.query_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      logger.info("dispute.auto_resolve.completed", {
        coolingExecuted,
        unresponsiveEvaluated,
        interactionsEscalated,
        errors,
      });

      return {
        coolingExecuted,
        unresponsiveEvaluated,
        interactionsEscalated,
        errors,
      };
    }, // end runWithRequestContext fn
  ); // end runWithRequestContext
}
