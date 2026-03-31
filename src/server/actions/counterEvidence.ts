"use server";
// src/server/actions/counterEvidence.ts
// ─── Counter-Evidence Submission ───────────────────────────────────────────
// Allows the affected party to submit counter-evidence during the 24-hour
// cooling period of an auto-resolution queue. Triggers re-evaluation.

import { safeActionError } from "@/shared/errors";
import { requireUser } from "@/server/lib/requireUser";
import db from "@/lib/db";
import { logger } from "@/shared/logger";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { autoResolutionService } from "@/modules/disputes/auto-resolution.service";
import { createNotification } from "@/modules/notifications/notification.service";
import type { ActionResult } from "@/types";
import { submitCounterEvidenceSchema } from "@/server/validators";

export async function submitCounterEvidence(
  raw: unknown,
): Promise<ActionResult<{ reEvaluated: boolean; newDecision?: string }>> {
  try {
    const user = await requireUser();

    const parsed = submitCounterEvidenceSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Please check your input.",
      };
    }

    const { orderId, description, evidenceKeys } = parsed.data;

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        listing: { select: { title: true } },
      },
    });

    if (!order) return { success: false, error: "Order not found." };

    const isBuyer = order.buyerId === user.id;
    const isSeller = order.sellerId === user.id;
    if (!isBuyer && !isSeller) {
      return { success: false, error: "You are not a party to this order." };
    }

    if (order.status !== "DISPUTED") {
      return {
        success: false,
        error: "Counter-evidence can only be submitted for disputed orders.",
      };
    }

    // Check there is a queued auto-resolution
    const queuedEvent = await db.orderEvent.findFirst({
      where: {
        orderId,
        type: "AUTO_RESOLVED",
        metadata: { path: ["status"], equals: "QUEUED" },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!queuedEvent) {
      return {
        success: false,
        error: "No pending auto-resolution to submit evidence against.",
      };
    }

    // Record the counter-evidence
    const role = isBuyer ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER;
    const roleLabel = isBuyer ? "Buyer" : "Seller";

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.DISPUTE_RESPONDED,
      actorId: user.id,
      actorRole: role,
      summary: `${roleLabel} submitted counter-evidence during cooling period`,
      metadata: {
        description: description.slice(0, 500),
        evidenceKeys,
        counterEvidenceFor: queuedEvent.id,
      },
    });

    // If seller, also store as seller response (so evaluateDispute picks it up)
    if (isSeller && !order.status) {
      // Seller response is already handled by the dispute flow
    }

    // Re-evaluate
    const reEval = await autoResolutionService.evaluateDispute(orderId);

    // Notify the other party
    const otherPartyId = isBuyer ? order.sellerId : order.buyerId;
    createNotification({
      userId: otherPartyId,
      type: "ORDER_DISPUTED",
      title: "New evidence submitted",
      body: `${roleLabel} submitted additional evidence for the dispute on "${order.listing.title}".`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    logger.info("counter-evidence.submitted", {
      orderId,
      userId: user.id,
      newDecision: reEval.decision,
      newScore: reEval.score,
    });

    return {
      success: true,
      data: {
        reEvaluated: true,
        newDecision: reEval.decision,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "We couldn't submit your evidence."),
    };
  }
}
