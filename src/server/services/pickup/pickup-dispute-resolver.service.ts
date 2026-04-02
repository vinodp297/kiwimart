// src/server/services/pickup/pickup-dispute-resolver.service.ts
// ─── Pickup Dispute Auto-Resolution Engine ──────────────────────────────────
// Evaluates pickup rejections and decides: AUTO_REFUND, AUTO_RELEASE, or MANUAL_REVIEW.
// Called when buyer rejects item at pickup (after seller initiated OTP, before code entry).

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { audit } from "@/server/lib/audit";
import { paymentService } from "@/modules/payments/payment.service";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendDisputeResolvedEmail } from "@/server/email";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { trustMetricsService } from "@/modules/trust/trust-metrics.service";
import {
  getDisputeByOrderId,
  resolveDispute as resolveDisputeRecord,
} from "@/server/services/dispute/dispute.service";

export type PickupDisputeDecision =
  | "AUTO_REFUND"
  | "AUTO_RELEASE"
  | "MANUAL_REVIEW";

export interface PickupDisputeResult {
  decision: PickupDisputeDecision;
  reason: string;
}

// ── resolvePickupDispute ────────────────────────────────────────────────────

export async function resolvePickupDispute(params: {
  orderId: string;
  reason: string;
  reasonNote?: string;
}): Promise<PickupDisputeResult> {
  const { orderId, reason, reasonNote } = params;

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      totalNzd: true,
      stripePaymentIntentId: true,
      listingId: true,
      listing: { select: { title: true } },
    },
  });

  if (!order) {
    return { decision: "MANUAL_REVIEW", reason: "Order not found" };
  }

  // Check if seller deserves benefit of the doubt
  const sellerMetrics = await trustMetricsService.getSellerMetrics(
    order.sellerId,
  );
  const isFirstPickupDispute =
    sellerMetrics.disputeRate < 5 && sellerMetrics.totalOrders >= 5;

  // ── Decision logic ──────────────────────────────────────────────────────

  let decision: PickupDisputeDecision;
  let decisionReason: string;

  if (reason === "OTHER") {
    // Ambiguous reason — needs human eyes
    decision = "MANUAL_REVIEW";
    decisionReason = `Buyer rejected with reason "Other": ${reasonNote ?? "no details"}. Requires admin review.`;
  } else if (isFirstPickupDispute && reason !== "ITEM_NOT_PRESENT") {
    // Seller has good track record and this is not a fraud signal — review first
    decision = "MANUAL_REVIEW";
    decisionReason = `Seller has ${sellerMetrics.disputeRate}% dispute rate and this is their first pickup dispute. Flagged for review rather than auto-refund.`;
  } else {
    // AUTO_REFUND: buyer inspected in person, strong signal
    decision = "AUTO_REFUND";
    switch (reason) {
      case "ITEM_NOT_PRESENT":
        decisionReason =
          "Seller initiated OTP (proving they claimed to be present) but buyer reports item was not physically present. Strong fraud signal.";
        break;
      case "ITEM_NOT_AS_DESCRIBED":
        decisionReason =
          "Buyer inspected item in person and found it not as described. ListingSnapshot exists for evidence.";
        break;
      case "SIGNIFICANTLY_DIFFERENT":
        decisionReason =
          "Buyer reports item is significantly different from listing photos. In-person inspection gives buyer strong standing.";
        break;
      case "ITEM_DAMAGED":
        decisionReason =
          "Buyer inspected item in person and found damage. In-person verification is definitive.";
        break;
      default:
        decision = "MANUAL_REVIEW";
        decisionReason = `Unknown rejection reason: ${reason}. Requires admin review.`;
    }
  }

  // ── Execute decision ────────────────────────────────────────────────────

  if (decision === "AUTO_REFUND") {
    await executeAutoRefund(order, reason, decisionReason);
  } else if (decision === "MANUAL_REVIEW") {
    await escalateToAdmin(order, reason, decisionReason, reasonNote);
  }

  logger.info("pickup.dispute.resolved", {
    orderId,
    decision,
    reason,
    decisionReason,
  });

  return { decision, reason: decisionReason };
}

// ── Internal: Execute auto-refund ───────────────────────────────────────────

async function executeAutoRefund(
  order: {
    id: string;
    buyerId: string;
    sellerId: string;
    totalNzd: number;
    stripePaymentIntentId: string | null;
    listingId: string;
    listing: { title: string };
  },
  reason: string,
  decisionReason: string,
): Promise<void> {
  // 1. Refund via Stripe
  if (order.stripePaymentIntentId) {
    try {
      await paymentService.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        orderId: order.id,
        reason: `Pickup dispute auto-refund: ${reason}`,
      });
    } catch (err) {
      logger.error("pickup.dispute.refund_failed", {
        orderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Update order status + resolve dispute record
  const dispute = await getDisputeByOrderId(order.id);
  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { status: "REFUNDED" },
    });
    if (dispute) {
      await resolveDisputeRecord({
        disputeId: dispute.id,
        decision: "BUYER_WON",
        resolvedBy: "SYSTEM",
        tx,
      });
    }
  });

  // 3. Restore listing
  await db.listing
    .updateMany({
      where: { id: order.listingId, status: "RESERVED" },
      data: { status: "ACTIVE" },
    })
    .catch(() => {});

  // 4. Update trust metrics for seller
  await db.trustMetrics
    .upsert({
      where: { userId: order.sellerId },
      create: {
        userId: order.sellerId,
        totalOrders: 0,
        completedOrders: 0,
        disputeCount: 1,
        disputeRate: 0,
        disputesLast30Days: 1,
        averageResponseHours: null,
        averageRating: null,
        dispatchPhotoRate: 0,
        accountAgeDays: 0,
        isFlaggedForFraud: reason === "ITEM_NOT_PRESENT",
        lastComputedAt: new Date(),
      },
      update: {
        disputeCount: { increment: 1 },
        disputesLast30Days: { increment: 1 },
        ...(reason === "ITEM_NOT_PRESENT" ? { isFlaggedForFraud: true } : {}),
      },
    })
    .catch(() => {});

  // 5. Record event
  orderEventService.recordEvent({
    orderId: order.id,
    type: ORDER_EVENT_TYPES.DISPUTE_RESOLVED,
    actorId: null,
    actorRole: ACTOR_ROLES.SYSTEM,
    summary: `Pickup dispute auto-resolved: refund to buyer. ${decisionReason}`,
    metadata: {
      decision: "AUTO_REFUND",
      reason,
      trigger: "PICKUP_DISPUTE",
    },
  });

  // 6. Notifications
  createNotification({
    userId: order.buyerId,
    type: "SYSTEM",
    title: "Pickup dispute resolved in your favour",
    body: `Your pickup dispute has been resolved in your favour. A full refund is on its way.`,
    orderId: order.id,
    link: `/orders/${order.id}`,
  }).catch(() => {});

  createNotification({
    userId: order.sellerId,
    type: "SYSTEM",
    title: "Pickup dispute resolved",
    body: `A pickup dispute was resolved in the buyer's favour for order ${order.id}.`,
    orderId: order.id,
    link: `/orders/${order.id}`,
  }).catch(() => {});

  // 7. Emails
  db.user
    .findMany({
      where: { id: { in: [order.buyerId, order.sellerId] } },
      select: { id: true, email: true, displayName: true },
    })
    .then((users) => {
      const buyer = users.find((u) => u.id === order.buyerId);
      const seller = users.find((u) => u.id === order.sellerId);
      if (buyer) {
        sendDisputeResolvedEmail({
          to: buyer.email,
          recipientName: buyer.displayName ?? "there",
          recipientRole: "buyer",
          orderId: order.id,
          listingTitle: order.listing.title,
          resolution: "BUYER_WON",
          refundAmount: order.totalNzd,
          adminNote: null,
        }).catch(() => {});
      }
      if (seller) {
        sendDisputeResolvedEmail({
          to: seller.email,
          recipientName: seller.displayName ?? "there",
          recipientRole: "seller",
          orderId: order.id,
          listingTitle: order.listing.title,
          resolution: "BUYER_WON",
          refundAmount: null,
          adminNote: null,
        }).catch(() => {});
      }
    })
    .catch(() => {});

  // 8. Audit
  audit({
    userId: null,
    action: "DISPUTE_RESOLVED",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      trigger: "PICKUP_DISPUTE_AUTO_RESOLVED",
      decision: "AUTO_REFUND",
      reason,
    },
  });
}

// ── Internal: Escalate to admin ─────────────────────────────────────────────

async function escalateToAdmin(
  order: {
    id: string;
    buyerId: string;
    sellerId: string;
    listing: { title: string };
  },
  reason: string,
  decisionReason: string,
  reasonNote?: string,
): Promise<void> {
  // Notify admin users
  const admins = await db.user.findMany({
    where: {
      isAdmin: true,
      adminRole: { in: ["DISPUTES_ADMIN", "SUPER_ADMIN"] },
      isBanned: false,
    },
    select: { id: true },
  });

  for (const admin of admins) {
    createNotification({
      userId: admin.id,
      type: "ORDER_DISPUTED",
      title: "Pickup dispute requires manual review",
      body: `Buyer rejected item at pickup for "${order.listing.title}". Reason: ${reason.replace(/_/g, " ").toLowerCase()}`,
      orderId: order.id,
      link: `/admin/disputes/${order.id}`,
    }).catch(() => {});
  }

  // Notify buyer
  createNotification({
    userId: order.buyerId,
    type: "SYSTEM",
    title: "Pickup dispute under review",
    body: "Your pickup dispute is under review. We will resolve it within 24 hours.",
    orderId: order.id,
    link: `/orders/${order.id}`,
  }).catch(() => {});

  // Record event
  orderEventService.recordEvent({
    orderId: order.id,
    type: ORDER_EVENT_TYPES.DISPUTE_RESPONDED,
    actorId: null,
    actorRole: ACTOR_ROLES.SYSTEM,
    summary: `Pickup dispute escalated to admin review. ${decisionReason}`,
    metadata: {
      decision: "MANUAL_REVIEW",
      reason,
      reasonNote,
      trigger: "PICKUP_DISPUTE",
    },
  });

  // Audit
  audit({
    userId: null,
    action: "DISPUTE_OPENED",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      trigger: "PICKUP_DISPUTE_ESCALATED",
      reason,
      reasonNote,
    },
  });
}
