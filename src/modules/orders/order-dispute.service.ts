// src/modules/orders/order-dispute.service.ts
// ─── Order dispute opening ────────────────────────────────────────────────────
// Exports: openDispute

import { CONFIG_KEYS, getConfigInt } from "@/lib/platform-config";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendDisputeOpenedEmail } from "@/server/email";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "./order-event.service";
import {
  createDispute,
  getDisputeByOrderId,
} from "@/server/services/dispute/dispute.service";
import { orderRepository } from "./order.repository";
import { transitionOrder } from "./order.transitions";
import type { OpenDisputeInput } from "./order.types";

// ── openDispute ───────────────────────────────────────────────────────────────

export async function openDispute(
  input: OpenDisputeInput,
  buyerId: string,
  ip: string,
): Promise<void> {
  logger.info("order.dispute.opening", { orderId: input.orderId, buyerId });

  const order = await orderRepository.findByIdForDispute(input.orderId);

  if (!order) throw AppError.notFound("Order");

  // Cash-on-pickup orders have no platform payment — disputes cannot be opened
  if (order.fulfillmentType === "CASH_ON_PICKUP") {
    throw new AppError(
      "INVALID_OPERATION",
      "Disputes cannot be opened for cash-on-pickup orders. No platform payment was involved in this transaction.",
      400,
    );
  }

  if (order.buyerId !== buyerId) {
    throw AppError.unauthorised("Only the buyer can open a dispute.");
  }

  if (order.status !== "DISPATCHED" && order.status !== "DELIVERED") {
    throw new AppError(
      "ORDER_WRONG_STATE",
      "Disputes can only be opened for dispatched or delivered orders.",
      400,
    );
  }

  // Check for existing dispute via Dispute model
  const existingDispute = await getDisputeByOrderId(input.orderId);
  if (existingDispute) {
    throw new AppError(
      "ORDER_WRONG_STATE",
      "A dispute has already been opened for this order.",
      400,
    );
  }

  if (order.dispatchedAt) {
    const disputeOpenWindowDays = await getConfigInt(
      CONFIG_KEYS.DISPUTE_OPEN_WINDOW_DAYS,
    );
    const disputeDeadline = new Date(
      order.dispatchedAt.getTime() +
        disputeOpenWindowDays * 24 * 60 * 60 * 1000,
    );
    if (new Date() > disputeDeadline) {
      throw new AppError(
        "ORDER_WRONG_STATE",
        `Disputes must be opened within ${disputeOpenWindowDays} days of dispatch.`,
        400,
      );
    }
  }

  // Transition Order status + create Dispute record in same transaction
  await orderRepository.$transaction(async (tx) => {
    await transitionOrder(
      input.orderId,
      "DISPUTED",
      {},
      { tx, fromStatus: order.status },
    );

    await createDispute({
      orderId: input.orderId,
      reason: input.reason,
      source: "STANDARD",
      buyerStatement: input.description,
      evidenceKeys: input.evidenceUrls ?? [],
      buyerId,
      tx,
    });
  });

  // Notify seller directly — BullMQ worker does not run on Vercel serverless
  try {
    await sendDisputeOpenedEmail({
      to: order.seller.email,
      sellerName: order.seller.displayName,
      buyerName: order.buyer?.displayName ?? "A buyer",
      listingTitle: order.listing.title,
      orderId: input.orderId,
      reason: input.reason,
      description: input.description,
    });
  } catch (err) {
    logger.warn("order.dispute.email.failed", {
      orderId: input.orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  audit({
    userId: buyerId,
    action: "DISPUTE_OPENED",
    entityType: "Order",
    entityId: input.orderId,
    metadata: {
      reason: input.reason,
      description: input.description.slice(0, 100),
    },
    ip,
  });

  orderEventService.recordEvent({
    orderId: input.orderId,
    type: ORDER_EVENT_TYPES.DISPUTE_OPENED,
    actorId: buyerId,
    actorRole: ACTOR_ROLES.BUYER,
    summary: `Buyer opened dispute: ${input.reason.replace(/_/g, " ").toLowerCase()}`,
    metadata: {
      reason: input.reason,
      description: input.description.slice(0, 200),
    },
  });

  // Notify seller that a dispute has been opened
  createNotification({
    userId: order.sellerId,
    type: "ORDER_DISPUTED",
    title: "⚠️ A dispute has been opened",
    body: `A buyer opened a dispute on "${order.listing.title}". Please check your dashboard.`,
    orderId: input.orderId,
    link: "/dashboard/seller?tab=orders",
  }).catch(() => {});

  logger.info("order.dispute.opened", { orderId: input.orderId, buyerId });
}
