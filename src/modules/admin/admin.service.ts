// src/modules/admin/admin.service.ts
// ─── Admin Service ───────────────────────────────────────────────────────────
// Admin-only operations. Framework-free. Takes adminUserId as parameter.

import { audit } from "@/server/lib/audit";
import { paymentService } from "@/modules/payments/payment.service";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { withLock } from "@/server/lib/distributedLock";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendDisputeResolvedEmail } from "@/server/email";
import {
  getDisputeByOrderId,
  resolveDispute as resolveDisputeRecord,
} from "@/server/services/dispute/dispute.service";
import { userRepository } from "@/modules/users/user.repository";
import { orderRepository } from "@/modules/orders/order.repository";
import { listingRepository } from "@/modules/listings/listing.repository";
import { adminRepository } from "./admin.repository";
import db from "@/lib/db";
import type { ReportAction, DisputeFavour } from "./admin.types";

export class AdminService {
  async banUser(
    userId: string,
    reason: string,
    adminUserId: string,
  ): Promise<void> {
    await db.$transaction(async (tx) => {
      await userRepository.setBanState(userId, true, reason, tx);
      await userRepository.deleteAllSessions(userId, tx);
    });

    audit({
      userId: adminUserId,
      action: "ADMIN_ACTION",
      entityType: "User",
      entityId: userId,
      metadata: { action: "ban", reason },
    });

    logger.info("admin.user.banned", { userId, adminUserId });
  }

  async unbanUser(userId: string, adminUserId: string): Promise<void> {
    await userRepository.setBanState(userId, false, null);

    audit({
      userId: adminUserId,
      action: "ADMIN_ACTION",
      entityType: "User",
      entityId: userId,
      metadata: { action: "unban" },
    });

    logger.info("admin.user.unbanned", { userId, adminUserId });
  }

  async toggleSellerEnabled(
    userId: string,
    adminUserId: string,
  ): Promise<void> {
    const user = await userRepository.findSellerEnabled(userId);
    if (!user) throw AppError.notFound("User");

    await userRepository.setSellerEnabled(userId, !user.sellerEnabled);

    audit({
      userId: adminUserId,
      action: "ADMIN_ACTION",
      entityType: "User",
      entityId: userId,
      metadata: { action: "toggle_seller", newValue: !user.sellerEnabled },
    });
  }

  async resolveReport(
    reportId: string,
    action: ReportAction,
    adminUserId: string,
  ): Promise<void> {
    const report = await adminRepository.findReportById(reportId);
    if (!report) throw AppError.notFound("Report");

    // Wrap all DB mutations in a transaction for atomicity
    await db.$transaction(async (tx) => {
      await adminRepository.resolveReport(reportId, adminUserId, tx);

      if (action === "remove" && report.listingId) {
        await listingRepository.setStatus(report.listingId, "REMOVED", tx);
      }

      if (action === "ban" && report.targetUserId) {
        await userRepository.setBanState(
          report.targetUserId,
          true,
          "Banned following report review.",
          tx,
        );
      }
    });

    // Delete sessions outside transaction — can't rollback session deletion anyway
    if (action === "ban" && report.targetUserId) {
      await userRepository.deleteAllSessions(report.targetUserId);
    }

    audit({
      userId: adminUserId,
      action: "ADMIN_ACTION",
      entityType: "Report",
      entityId: reportId,
      metadata: { action },
    });

    logger.info("admin.report.resolved", { reportId, action, adminUserId });
  }

  async resolveDispute(
    orderId: string,
    favour: DisputeFavour,
    adminUserId: string,
  ): Promise<void> {
    const order = await orderRepository.findWithDisputeContext(orderId);

    if (!order) throw AppError.notFound("Order");
    if (order.status !== "DISPUTED") {
      throw new AppError("ORDER_WRONG_STATE", "Order is not in dispute.", 400);
    }
    if (!order.stripePaymentIntentId) {
      throw AppError.missingPaymentIntent();
    }

    // Extract after null check so TypeScript narrows the type inside the async callback
    const paymentIntentId = order.stripePaymentIntentId;

    // Fetch dispute record for resolution
    const dispute = await getDisputeByOrderId(orderId);

    try {
      await withLock(`dispute:${orderId}`, async () => {
        if (favour === "buyer") {
          // DB first (optimistic) — then Stripe refund.
          await db.$transaction(async (tx) => {
            await transitionOrder(
              orderId,
              "REFUNDED",
              {},
              { tx, fromStatus: order.status },
            );
            // Restore listing to ACTIVE so seller can re-list
            if (order.listingId) {
              await listingRepository.setStatus(order.listingId, "ACTIVE", tx);
            }
            if (dispute) {
              await resolveDisputeRecord({
                disputeId: dispute.id,
                decision: "BUYER_WON",
                resolvedBy: adminUserId,
                tx,
              });
            }
          });

          try {
            await paymentService.refundPayment({
              paymentIntentId,
              orderId,
            });
          } catch (stripeError) {
            // Log for manual intervention — DB already updated
            logger.error("admin.dispute.refund_failed", {
              orderId,
              stripePaymentIntentId: paymentIntentId,
              error:
                stripeError instanceof Error
                  ? stripeError.message
                  : String(stripeError),
            });
            // Don't re-throw — admin sees REFUNDED status and can retry Stripe manually
          }
        } else {
          // Seller wins — capture first, then atomically update DB
          await paymentService.capturePayment({
            paymentIntentId,
            orderId,
          });

          await db.$transaction(async (tx) => {
            await transitionOrder(
              orderId,
              "COMPLETED",
              {
                completedAt: new Date(),
              },
              { tx, fromStatus: order.status },
            );
            await adminRepository.updateOrderPayouts(
              orderId,
              { status: "PROCESSING", initiatedAt: new Date() },
              tx,
            );
            if (dispute) {
              await resolveDisputeRecord({
                disputeId: dispute.id,
                decision: "SELLER_WON",
                resolvedBy: adminUserId,
                tx,
              });
            }
          });
        }
      });
    } catch (lockErr) {
      // Fail-closed: Redis unavailable in production → surface retry message
      if (
        lockErr instanceof Error &&
        lockErr.message.includes("temporarily unavailable")
      ) {
        throw new AppError(
          "STRIPE_ERROR",
          "Service temporarily unavailable. Please try again in a moment.",
          503,
        );
      }
      throw lockErr;
    }

    audit({
      userId: adminUserId,
      action: "DISPUTE_RESOLVED",
      entityType: "Order",
      entityId: orderId,
      metadata: { favour, resolvedAt: new Date().toISOString() },
    });

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.DISPUTE_RESOLVED,
      actorId: adminUserId,
      actorRole: ACTOR_ROLES.ADMIN,
      summary:
        favour === "buyer"
          ? "Dispute resolved in favour of buyer — refund issued"
          : "Dispute resolved in favour of seller — payment released",
      metadata: {
        favour,
        resolution: favour === "buyer" ? "refund" : "release",
      },
    });

    logger.info("admin.dispute.resolved", { orderId, favour, adminUserId });

    // In-app notifications for both parties
    const listingTitle = order.listing?.title ?? "your order";
    const buyerMsg =
      favour === "buyer"
        ? `Your dispute for "${listingTitle}" was resolved in your favour — a refund has been issued.`
        : `Your dispute for "${listingTitle}" was resolved in favour of the seller.`;
    const sellerMsg =
      favour === "seller"
        ? `The dispute for "${listingTitle}" was resolved in your favour — payment will be released.`
        : `The dispute for "${listingTitle}" was resolved in favour of the buyer.`;
    createNotification({
      userId: order.buyerId,
      type: "SYSTEM",
      title: "Dispute resolved",
      body: buyerMsg,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});
    createNotification({
      userId: order.sellerId,
      type: "SYSTEM",
      title: "Dispute resolved",
      body: sellerMsg,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    // Fire-and-forget dispute resolved emails to both parties
    orderRepository
      .findByIdForCancellationEmail(orderId)
      .then((o) => {
        if (!o) return;
        const resolution =
          favour === "buyer" ? ("BUYER_WON" as const) : ("SELLER_WON" as const);
        const refundAmount = favour === "buyer" ? o.totalNzd : null;
        sendDisputeResolvedEmail({
          to: o.buyer.email,
          recipientName: o.buyer.displayName ?? "there",
          recipientRole: "buyer",
          orderId,
          listingTitle: o.listing.title,
          resolution,
          refundAmount,
          adminNote: null,
        }).catch(() => {});
        sendDisputeResolvedEmail({
          to: o.seller.email,
          recipientName: o.seller.displayName ?? "there",
          recipientRole: "seller",
          orderId,
          listingTitle: o.listing.title,
          resolution,
          refundAmount: null,
          adminNote: null,
        }).catch(() => {});
      })
      .catch(() => {});
  }

  /**
   * Resolve dispute with partial refund.
   */
  async resolveDisputePartialRefund(
    orderId: string,
    amountCents: number,
    reason: string,
    adminUserId: string,
  ): Promise<void> {
    const order = await orderRepository.findWithDisputeContext(orderId);

    if (!order) throw AppError.notFound("Order");
    if (order.status !== "DISPUTED") {
      throw new AppError("ORDER_WRONG_STATE", "Order is not in dispute.", 400);
    }
    if (!order.stripePaymentIntentId) {
      throw AppError.missingPaymentIntent();
    }
    if (amountCents > order.totalNzd) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Partial refund cannot exceed order total.",
        400,
      );
    }

    const paymentIntentId = order.stripePaymentIntentId;

    // Fetch dispute record
    const dispute = await getDisputeByOrderId(orderId);

    await withLock(`dispute:${orderId}`, async () => {
      await db.$transaction(async (tx) => {
        await transitionOrder(
          orderId,
          "COMPLETED",
          {
            completedAt: new Date(),
          },
          { tx, fromStatus: order.status },
        );
        if (dispute) {
          await resolveDisputeRecord({
            disputeId: dispute.id,
            decision: "PARTIAL",
            refundAmount: amountCents,
            adminNotes: reason,
            resolvedBy: adminUserId,
            tx,
          });
        }
      });

      try {
        await paymentService.refundPayment({
          paymentIntentId,
          orderId,
          reason: `Partial refund ($${(amountCents / 100).toFixed(2)}): ${reason}`,
        });
      } catch (err) {
        logger.error("admin.dispute.partial_refund_failed", {
          orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Capture remaining amount
      try {
        await paymentService.capturePayment({
          paymentIntentId,
          orderId,
        });
      } catch {
        // Payment may already be captured
      }
    });

    const refundDollars = (amountCents / 100).toFixed(2);

    audit({
      userId: adminUserId,
      action: "DISPUTE_RESOLVED",
      entityType: "Order",
      entityId: orderId,
      metadata: {
        favour: "partial",
        refundAmount: amountCents,
        reason,
      },
    });

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.DISPUTE_RESOLVED,
      actorId: adminUserId,
      actorRole: ACTOR_ROLES.ADMIN,
      summary: `Partial refund of $${refundDollars} issued to buyer. Reason: ${reason}`,
      metadata: {
        favour: "partial",
        refundAmount: amountCents,
        reason,
      },
    });

    createNotification({
      userId: order.buyerId,
      type: "SYSTEM",
      title: "Dispute resolved — partial refund",
      body: `A partial refund of $${refundDollars} has been issued for "${order.listing.title}".`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    createNotification({
      userId: order.sellerId,
      type: "SYSTEM",
      title: "Dispute resolved — partial refund to buyer",
      body: `A partial refund of $${refundDollars} was issued for "${order.listing.title}". The remaining balance will be released.`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    logger.info("admin.dispute.partial_refund", {
      orderId,
      amountCents,
      adminUserId,
    });

    // Fire-and-forget partial refund emails to both parties
    userRepository
      .findManyEmailContactsByIds([order.buyerId, order.sellerId])
      .then((users) => {
        const buyer = users.find((u) => u.id === order.buyerId);
        const seller = users.find((u) => u.id === order.sellerId);
        if (buyer) {
          sendDisputeResolvedEmail({
            to: buyer.email,
            recipientName: buyer.displayName ?? "there",
            recipientRole: "buyer",
            orderId,
            listingTitle: order.listing.title,
            resolution: "PARTIAL_REFUND",
            refundAmount: amountCents,
            adminNote: reason,
          }).catch(() => {});
        }
        if (seller) {
          sendDisputeResolvedEmail({
            to: seller.email,
            recipientName: seller.displayName ?? "there",
            recipientRole: "seller",
            orderId,
            listingTitle: order.listing.title,
            resolution: "PARTIAL_REFUND",
            refundAmount: amountCents,
            adminNote: reason,
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }

  /**
   * Override an auto-resolution decision during cooling period or after execution.
   */
  async overrideAutoResolution(
    orderId: string,
    newDecision: "refund" | "dismiss" | "partial_refund",
    reason: string,
    adminUserId: string,
    partialAmountCents?: number,
  ): Promise<void> {
    // Find the auto-resolution event to record the override
    const autoResEvent =
      await adminRepository.findLatestAutoResolvedEvent(orderId);

    const originalDecision = autoResEvent
      ? String(
          (autoResEvent.metadata as Record<string, unknown>).decision ?? "",
        )
      : "UNKNOWN";

    // Record the override event
    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.DISPUTE_RESOLVED,
      actorId: adminUserId,
      actorRole: ACTOR_ROLES.ADMIN,
      summary: `Admin override — Original: ${originalDecision}. New decision: ${newDecision.toUpperCase()}. Reason: ${reason}`,
      metadata: {
        type: "ADMIN_OVERRIDE",
        originalDecision,
        newDecision,
        reason,
        partialAmountCents,
      },
    });

    // Execute the new decision
    if (newDecision === "refund") {
      await this.resolveDispute(orderId, "buyer", adminUserId);
    } else if (newDecision === "dismiss") {
      await this.resolveDispute(orderId, "seller", adminUserId);
    } else if (newDecision === "partial_refund" && partialAmountCents) {
      await this.resolveDisputePartialRefund(
        orderId,
        partialAmountCents,
        reason,
        adminUserId,
      );
    }

    audit({
      userId: adminUserId,
      action: "ADMIN_ACTION",
      entityType: "Order",
      entityId: orderId,
      metadata: {
        action: "override_auto_resolution",
        originalDecision,
        newDecision,
        reason,
      },
    });

    logger.info("admin.dispute.override", {
      orderId,
      originalDecision,
      newDecision,
      adminUserId,
    });
  }

  /**
   * Request more information from a party in a dispute.
   */
  async requestMoreInfo(
    orderId: string,
    target: "buyer" | "seller" | "both",
    message: string,
    adminUserId: string,
  ): Promise<void> {
    const order = await orderRepository.findWithDisputeContext(orderId);

    if (!order) throw AppError.notFound("Order");

    const targets =
      target === "both"
        ? [order.buyerId, order.sellerId]
        : target === "buyer"
          ? [order.buyerId]
          : [order.sellerId];

    for (const userId of targets) {
      createNotification({
        userId,
        type: "ORDER_DISPUTED",
        title: "More information requested",
        body: `Our team needs more information about the dispute on "${order.listing.title}": ${message}`,
        orderId,
        link: `/orders/${orderId}`,
      }).catch(() => {});
    }

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.DISPUTE_RESPONDED,
      actorId: adminUserId,
      actorRole: ACTOR_ROLES.ADMIN,
      summary: `Admin requested more information from ${target}: ${message.slice(0, 200)}`,
      metadata: { target, message },
    });

    audit({
      userId: adminUserId,
      action: "ADMIN_ACTION",
      entityType: "Order",
      entityId: orderId,
      metadata: {
        action: "request_info",
        target,
        message: message.slice(0, 200),
      },
    });

    logger.info("admin.dispute.request_info", {
      orderId,
      target,
      adminUserId,
    });
  }

  /**
   * Flag a user for fraud from the dispute panel.
   */
  async flagUserForFraud(
    userId: string,
    orderId: string,
    reason: string,
    adminUserId: string,
  ): Promise<void> {
    await adminRepository.flagUserForFraud(userId);

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.FRAUD_FLAGGED,
      actorId: adminUserId,
      actorRole: ACTOR_ROLES.ADMIN,
      summary: `Admin flagged user ${userId} for fraud: ${reason}`,
      metadata: { flaggedUserId: userId, reason },
    });

    audit({
      userId: adminUserId,
      action: "FRAUD_FLAGGED",
      entityType: "User",
      entityId: userId,
      metadata: { orderId, reason },
    });

    logger.info("admin.fraud.flagged", {
      flaggedUserId: userId,
      orderId,
      adminUserId,
    });
  }
}

export const adminService = new AdminService();
