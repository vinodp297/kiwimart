"use server";
// src/server/actions/pickup.actions.ts
// ─── Pickup Server Actions ──────────────────────────────────────────────────
// OTP initiation (seller), OTP confirmation (buyer), item rejection (buyer).

import { safeActionError } from "@/shared/errors";
import { getRequestContext } from "@/lib/request-context";
import { requireUser } from "@/server/lib/requireUser";
import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { createNotification } from "@/modules/notifications/notification.service";
import { paymentService } from "@/modules/payments/payment.service";
import { transitionOrder } from "@/modules/orders/order.transitions";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import {
  generateAndSendOTP,
  verifyOTP,
} from "@/server/services/pickup/pickup-otp.service";
import { resolvePickupDispute } from "@/server/services/pickup/pickup-dispute-resolver.service";
import { createDispute } from "@/server/services/dispute/dispute.service";
import { sendPayoutInitiatedEmail } from "@/server/email";
import { pickupQueue } from "@/lib/queue";
import { getConfigInt, CONFIG_KEYS } from "@/lib/platform-config";
import type { ActionResult } from "@/types";
import type { DisputeReason } from "@prisma/client";

// ── initiatePickupOTP ───────────────────────────────────────────────────────

export async function initiatePickupOTP(
  orderId: string,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        fulfillmentType: true,
        pickupStatus: true,
        pickupScheduledAt: true,
        pickupWindowExpiresAt: true,
        buyer: {
          select: { phone: true, displayName: true },
        },
        listing: { select: { title: true } },
      },
    });

    if (!order) return { success: false, error: "Order not found." };

    // Must be the seller
    if (order.sellerId !== user.id) {
      return {
        success: false,
        error: "Only the seller can initiate pickup confirmation.",
      };
    }

    // Validate fulfillment type
    if (order.fulfillmentType !== "ONLINE_PAYMENT_PICKUP") {
      return {
        success: false,
        error: "OTP confirmation only applies to online-payment pickup orders.",
      };
    }

    // Validate pickup status
    if (order.pickupStatus !== "SCHEDULED") {
      return {
        success: false,
        error: "Pickup must be in SCHEDULED state to initiate OTP.",
      };
    }

    // Validate time window: within config-driven minutes before to window expiry
    if (!order.pickupScheduledAt || !order.pickupWindowExpiresAt) {
      return { success: false, error: "No pickup time scheduled." };
    }

    const otpEarlyMinutes = await getConfigInt(
      CONFIG_KEYS.PICKUP_OTP_EARLY_INITIATION_MINUTES,
    );
    const now = Date.now();
    const earliestInitiation =
      order.pickupScheduledAt.getTime() - otpEarlyMinutes * 60 * 1000;
    const latestInitiation = order.pickupWindowExpiresAt.getTime();

    if (now < earliestInitiation || now > latestInitiation) {
      return {
        success: false,
        error: `You can only initiate pickup confirmation within ${otpEarlyMinutes} minutes of the scheduled time.`,
      };
    }

    // Validate buyer has phone
    const buyerPhone = order.buyer.phone;
    if (!buyerPhone) {
      return {
        success: false,
        error:
          "Buyer does not have a phone number on file. They need to add one before pickup can be confirmed.",
      };
    }

    // Run in transaction
    await db.$transaction(async (tx) => {
      await generateAndSendOTP({
        orderId: order.id,
        buyerPhone,
        buyerName: order.buyer.displayName ?? "there",
        listingTitle: order.listing.title,
        tx,
      });
    });

    // Record event
    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.ORDER_CREATED,
      actorId: user.id,
      actorRole: ACTOR_ROLES.SELLER,
      summary: "Seller initiated pickup OTP confirmation",
      metadata: { action: "PICKUP_OTP_INITIATED" },
    });

    // Audit
    audit({
      userId: user.id,
      action: "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: orderId,
      metadata: {
        action: "PICKUP_OTP_INITIATED",
        pickupStatus: "OTP_INITIATED",
      },
    });

    // Schedule OTP expiry job — delay matches config value used by pickup-otp.service
    const otpExpiryMinutes = await getConfigInt(
      CONFIG_KEYS.PICKUP_OTP_EXPIRY_MINUTES,
    );
    const otpJobId = `otp-expired-${orderId}`;
    await pickupQueue
      .add(
        "PICKUP_JOB",
        {
          type: "OTP_EXPIRED" as const,
          orderId,
          correlationId: getRequestContext()?.correlationId,
        },
        {
          delay: otpExpiryMinutes * 60 * 1000,
          jobId: otpJobId,
        },
      )
      .catch((err) => {
        logger.warn("pickup.otp.job_schedule_failed", {
          orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // Store job ID
    await db.order
      .update({
        where: { id: orderId },
        data: { otpJobId },
      })
      .catch(() => {});

    // Notify buyer
    createNotification({
      userId: order.buyerId,
      type: "SYSTEM",
      title: "Pickup confirmation started",
      body: "The seller has initiated pickup confirmation. Check your SMS for your 6-digit code.",
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "Could not initiate pickup confirmation. Please try again.",
      ),
    };
  }
}

// ── confirmPickupOTP ────────────────────────────────────────────────────────

export async function confirmPickupOTP(
  orderId: string,
  enteredCode: string,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        fulfillmentType: true,
        pickupStatus: true,
        stripePaymentIntentId: true,
        totalNzd: true,
        listingId: true,
        otpJobId: true,
        pickupWindowJobId: true,
        listing: { select: { title: true } },
        seller: { select: { stripeAccountId: true } },
      },
    });

    if (!order) return { success: false, error: "Order not found." };

    // Must be the buyer
    if (order.buyerId !== user.id) {
      return {
        success: false,
        error: "Only the buyer can enter the pickup code.",
      };
    }

    if (order.fulfillmentType !== "ONLINE_PAYMENT_PICKUP") {
      return { success: false, error: "Not a pickup order." };
    }

    if (order.pickupStatus !== "OTP_INITIATED") {
      return { success: false, error: "No active OTP for this order." };
    }

    if (!order.stripePaymentIntentId) {
      return { success: false, error: "No payment found for this order." };
    }

    // Run in transaction
    await db.$transaction(async (tx) => {
      // Verify OTP
      const otpResult = await verifyOTP({ orderId, enteredCode, tx });
      if (!otpResult.valid) {
        throw new Error(otpResult.error ?? "Invalid OTP");
      }

      // Capture Stripe payment
      await paymentService.capturePayment({
        paymentIntentId: order.stripePaymentIntentId!,
        orderId,
      });

      // Update order status
      await transitionOrder(
        orderId,
        "COMPLETED",
        {
          pickupStatus: "COMPLETED",
          pickupConfirmedAt: new Date(),
          completedAt: new Date(),
        },
        { tx, fromStatus: order.status },
      );

      // Create payout record
      await tx.payout.upsert({
        where: { orderId },
        create: {
          orderId,
          userId: order.sellerId,
          amountNzd: order.totalNzd,
          platformFeeNzd: 0,
          stripeFeeNzd: 0,
          status: "PROCESSING",
          initiatedAt: new Date(),
        },
        update: {
          status: "PROCESSING",
          initiatedAt: new Date(),
        },
      });

      // Mark listing as SOLD
      await tx.listing
        .update({
          where: { id: order.listingId },
          data: { status: "SOLD", soldAt: new Date() },
        })
        .catch(() => {});
    });

    // Cancel BullMQ jobs
    if (order.otpJobId) {
      pickupQueue.remove(order.otpJobId).catch(() => {});
    }
    if (order.pickupWindowJobId) {
      pickupQueue.remove(order.pickupWindowJobId).catch(() => {});
    }

    // Record event
    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.COMPLETED,
      actorId: user.id,
      actorRole: ACTOR_ROLES.BUYER,
      summary: "Buyer confirmed pickup with OTP — payment captured",
      metadata: { action: "PICKUP_OTP_CONFIRMED" },
    });

    // Audit
    audit({
      userId: user.id,
      action: "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: orderId,
      metadata: {
        newStatus: "COMPLETED",
        action: "PICKUP_OTP_CONFIRMED",
      },
    });

    // Notify both parties
    const amount = `$${(order.totalNzd / 100).toFixed(2)} NZD`;

    createNotification({
      userId: order.buyerId,
      type: "ORDER_COMPLETED",
      title: "Pickup complete!",
      body: `Your order for "${order.listing.title}" is now marked as collected.`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    createNotification({
      userId: order.sellerId,
      type: "ORDER_COMPLETED",
      title: "Pickup confirmed! 💰",
      body: `Pickup confirmed! Your payment of ${amount} is being processed.`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    // Send payout email to seller (fire-and-forget)
    db.user
      .findUnique({
        where: { id: order.sellerId },
        select: { email: true, displayName: true },
      })
      .then((seller) => {
        if (!seller) return;
        sendPayoutInitiatedEmail({
          to: seller.email,
          sellerName: seller.displayName ?? "there",
          amountNzd: order.totalNzd,
          listingTitle: order.listing.title,
          orderId,
          estimatedArrival: "2–3 business days",
        }).catch(() => {});
      })
      .catch(() => {});

    return { success: true, data: undefined };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not confirm pickup.";
    // If the error is from OTP verification, return it directly
    if (
      message.includes("Incorrect code") ||
      message.includes("expired") ||
      message.includes("No active OTP")
    ) {
      return { success: false, error: message };
    }
    return {
      success: false,
      error: safeActionError(
        err,
        "Could not confirm pickup. Please try again.",
      ),
    };
  }
}

// ── rejectItemAtPickup ──────────────────────────────────────────────────────

type PickupRejectReason =
  | "ITEM_NOT_AS_DESCRIBED"
  | "ITEM_DAMAGED"
  | "ITEM_NOT_PRESENT"
  | "SIGNIFICANTLY_DIFFERENT"
  | "OTHER";

// Map pickup rejection reasons to DisputeReason enum
const PICKUP_TO_DISPUTE_REASON: Record<PickupRejectReason, DisputeReason> = {
  ITEM_NOT_AS_DESCRIBED: "ITEM_NOT_AS_DESCRIBED",
  ITEM_DAMAGED: "ITEM_DAMAGED",
  ITEM_NOT_PRESENT: "ITEM_NOT_RECEIVED",
  SIGNIFICANTLY_DIFFERENT: "ITEM_NOT_AS_DESCRIBED",
  OTHER: "OTHER",
};

export async function rejectItemAtPickup(
  orderId: string,
  params: {
    reason: PickupRejectReason;
    reasonNote?: string;
    evidenceKeys?: string[];
  },
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        fulfillmentType: true,
        pickupStatus: true,
        otpJobId: true,
        listingId: true,
        listing: { select: { title: true } },
      },
    });

    if (!order) return { success: false, error: "Order not found." };

    // Must be the buyer
    if (order.buyerId !== user.id) {
      return {
        success: false,
        error: "Only the buyer can reject an item at pickup.",
      };
    }

    if (order.fulfillmentType !== "ONLINE_PAYMENT_PICKUP") {
      return { success: false, error: "Not a pickup order." };
    }

    // Can only reject after OTP initiated, before entry
    if (order.pickupStatus !== "OTP_INITIATED") {
      return {
        success: false,
        error:
          "Items can only be rejected after the seller initiates confirmation and before you enter the code.",
      };
    }

    // Validate OTHER requires reasonNote >= 20 chars
    if (
      params.reason === "OTHER" &&
      (!params.reasonNote || params.reasonNote.trim().length < 20)
    ) {
      return {
        success: false,
        error: "Please provide a genuine reason (at least 20 characters).",
      };
    }

    const disputeReason = PICKUP_TO_DISPUTE_REASON[params.reason];

    // Update order in transaction + create Dispute record
    await db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          pickupStatus: "REJECTED_AT_PICKUP",
          pickupRejectedAt: new Date(),
          status: "DISPUTED",
          // Clear OTP fields
          otpCodeHash: null,
          otpExpiresAt: null,
        },
      });

      await createDispute({
        orderId,
        reason: disputeReason,
        source: "PICKUP_REJECTION",
        buyerStatement: params.reasonNote ?? null,
        evidenceKeys: params.evidenceKeys ?? [],
        buyerId: user.id,
        tx,
      });
    });

    // Record event
    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.DISPUTE_OPENED,
      actorId: user.id,
      actorRole: ACTOR_ROLES.BUYER,
      summary: `Buyer rejected item at pickup: ${params.reason.replace(/_/g, " ").toLowerCase()}`,
      metadata: {
        action: "PICKUP_ITEM_REJECTED",
        reason: params.reason,
        reasonNote: params.reasonNote,
        evidenceCount: params.evidenceKeys?.length ?? 0,
      },
    });

    // Audit
    audit({
      userId: user.id,
      action: "DISPUTE_OPENED",
      entityType: "Order",
      entityId: orderId,
      metadata: {
        trigger: "PICKUP_REJECTION",
        reason: params.reason,
      },
    });

    // Cancel OTP expiry job
    if (order.otpJobId) {
      pickupQueue.remove(order.otpJobId).catch(() => {});
    }

    // Run auto-resolution engine
    resolvePickupDispute({
      orderId,
      reason: params.reason,
      reasonNote: params.reasonNote,
    }).catch((err) => {
      logger.error("pickup.dispute.auto_resolve_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "Could not reject the item. Please try again.",
      ),
    };
  }
}
