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
import { orderRepository } from "@/modules/orders/order.repository";
import { listingRepository } from "@/modules/listings/listing.repository";
import { adminRepository } from "@/modules/admin/admin.repository";
import { fireAndForget } from "@/lib/fire-and-forget";

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

  const order = await orderRepository.findWithDisputeContext(orderId);

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
    buyer: { email: string; displayName: string | null } | null;
    seller: { email: string; displayName: string | null } | null;
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
    await orderRepository.updatePickupFields(
      order.id,
      { status: "REFUNDED" },
      tx,
    );
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
  await listingRepository.reactivate(order.listingId).catch((err: unknown) => {
    logger.error("pickup.dispute.reactivateListing.failed", {
      orderId: order.id,
      listingId: order.listingId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // 4. Update trust metrics for seller
  await adminRepository
    .recordSellerDisputeFromPickup(
      order.sellerId,
      reason === "ITEM_NOT_PRESENT",
    )
    .catch((err: unknown) => {
      logger.error("pickup.dispute.recordSellerMetrics.failed", {
        orderId: order.id,
        sellerId: order.sellerId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

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
  fireAndForget(
    createNotification({
      userId: order.buyerId,
      type: "SYSTEM",
      title: "Pickup dispute resolved in your favour",
      body: `Your pickup dispute has been resolved in your favour. A full refund is on its way.`,
      orderId: order.id,
      link: `/orders/${order.id}`,
    }),
    "pickup.dispute.autoRefund.buyerNotification",
    { orderId: order.id },
  );

  fireAndForget(
    createNotification({
      userId: order.sellerId,
      type: "SYSTEM",
      title: "Pickup dispute resolved",
      body: `A pickup dispute was resolved in the buyer's favour for order ${order.id}.`,
      orderId: order.id,
      link: `/orders/${order.id}`,
    }),
    "pickup.dispute.autoRefund.sellerNotification",
    { orderId: order.id },
  );

  // 7. Emails
  if (order.buyer) {
    fireAndForget(
      sendDisputeResolvedEmail({
        to: order.buyer.email,
        recipientName: order.buyer.displayName ?? "there",
        recipientRole: "buyer",
        orderId: order.id,
        listingTitle: order.listing.title,
        resolution: "BUYER_WON",
        refundAmount: order.totalNzd,
        adminNote: null,
      }),
      "pickup.dispute.autoRefund.buyerEmail",
      { orderId: order.id },
    );
  }
  if (order.seller) {
    fireAndForget(
      sendDisputeResolvedEmail({
        to: order.seller.email,
        recipientName: order.seller.displayName ?? "there",
        recipientRole: "seller",
        orderId: order.id,
        listingTitle: order.listing.title,
        resolution: "BUYER_WON",
        refundAmount: null,
        adminNote: null,
      }),
      "pickup.dispute.autoRefund.sellerEmail",
      { orderId: order.id },
    );
  }

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
  const admins = await adminRepository.findDisputeAdmins();

  for (const admin of admins) {
    fireAndForget(
      createNotification({
        userId: admin.id,
        type: "ORDER_DISPUTED",
        title: "Pickup dispute requires manual review",
        body: `Buyer rejected item at pickup for "${order.listing.title}". Reason: ${reason.replace(/_/g, " ").toLowerCase()}`,
        orderId: order.id,
        link: `/admin/disputes/${order.id}`,
      }),
      "pickup.dispute.escalate.adminNotification",
      { orderId: order.id, adminId: admin.id },
    );
  }

  // Notify buyer
  fireAndForget(
    createNotification({
      userId: order.buyerId,
      type: "SYSTEM",
      title: "Pickup dispute under review",
      body: "Your pickup dispute is under review. We will resolve it within 24 hours.",
      orderId: order.id,
      link: `/orders/${order.id}`,
    }),
    "pickup.dispute.escalate.buyerNotification",
    { orderId: order.id },
  );

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
