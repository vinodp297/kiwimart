// src/modules/admin/admin-dispute.service.ts
// ─── Dispute management methods ───────────────────────────────────────────────

import { audit } from "@/server/lib/audit";
import { formatCentsAsNzd } from "@/lib/currency";
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
import { fireAndForget } from "@/lib/fire-and-forget";
import { sendDisputeResolvedEmail } from "@/server/email";
import {
  getDisputeByOrderId,
  resolveDispute as resolveDisputeRecord,
} from "@/server/services/dispute/dispute.service";
import { userRepository } from "@/modules/users/user.repository";
import { orderRepository } from "@/modules/orders/order.repository";
import { listingRepository } from "@/modules/listings/listing.repository";
import { adminRepository } from "./admin.repository";
import type { DisputeFavour } from "./admin.types";

export const adminDisputeService = {
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

    const paymentIntentId = order.stripePaymentIntentId;

    const dispute = await getDisputeByOrderId(orderId);

    try {
      await withLock(`dispute:${orderId}`, async () => {
        if (favour === "buyer") {
          await orderRepository.$transaction(async (tx) => {
            await transitionOrder(
              orderId,
              "REFUNDED",
              {},
              { tx, fromStatus: order.status },
            );
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
            logger.error("admin.dispute.refund_failed", {
              orderId,
              stripePaymentIntentId: paymentIntentId,
              error:
                stripeError instanceof Error
                  ? stripeError.message
                  : String(stripeError),
            });
          }
        } else {
          await paymentService.capturePayment({
            paymentIntentId,
            orderId,
          });

          await orderRepository.$transaction(async (tx) => {
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
      if (lockErr instanceof AppError && lockErr.code === "LOCK_UNAVAILABLE") {
        throw new AppError(
          "PAYMENT_GATEWAY_ERROR",
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

    const listingTitle = order.listing?.title ?? "your order";
    const buyerMsg =
      favour === "buyer"
        ? `Your dispute for "${listingTitle}" was resolved in your favour — a refund has been issued.`
        : `Your dispute for "${listingTitle}" was resolved in favour of the seller.`;
    const sellerMsg =
      favour === "seller"
        ? `The dispute for "${listingTitle}" was resolved in your favour — payment will be released.`
        : `The dispute for "${listingTitle}" was resolved in favour of the buyer.`;
    fireAndForget(
      createNotification({
        userId: order.buyerId,
        type: "SYSTEM",
        title: "Dispute resolved",
        body: buyerMsg,
        orderId,
        link: `/orders/${orderId}`,
      }),
      "admin.dispute.notify.buyer",
      { orderId, userId: order.buyerId },
    );
    fireAndForget(
      createNotification({
        userId: order.sellerId,
        type: "SYSTEM",
        title: "Dispute resolved",
        body: sellerMsg,
        orderId,
        link: `/orders/${orderId}`,
      }),
      "admin.dispute.notify.seller",
      { orderId, userId: order.sellerId },
    );

    fireAndForget(
      orderRepository.findByIdForEmail(orderId).then((o) => {
        if (!o) return;
        const resolution =
          favour === "buyer" ? ("BUYER_WON" as const) : ("SELLER_WON" as const);
        const refundAmount = favour === "buyer" ? o.totalNzd : null;
        fireAndForget(
          sendDisputeResolvedEmail({
            to: o.buyer.email,
            recipientName: o.buyer.displayName ?? "there",
            recipientRole: "buyer",
            orderId,
            listingTitle: o.listing.title,
            resolution,
            refundAmount,
            adminNote: null,
          }),
          "admin.dispute.email.buyer",
          { orderId },
        );
        fireAndForget(
          sendDisputeResolvedEmail({
            to: o.seller.email,
            recipientName: o.seller.displayName ?? "there",
            recipientRole: "seller",
            orderId,
            listingTitle: o.listing.title,
            resolution,
            refundAmount: null,
            adminNote: null,
          }),
          "admin.dispute.email.seller",
          { orderId },
        );
      }),
      "admin.dispute.emailLookup",
      { orderId },
    );
  },

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

    const dispute = await getDisputeByOrderId(orderId);

    await withLock(`dispute:${orderId}`, async () => {
      await orderRepository.$transaction(async (tx) => {
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

      await paymentService.refundPayment({
        paymentIntentId,
        orderId,
        amountNzd: amountCents,
        reason: `Partial refund (${formatCentsAsNzd(amountCents)}): ${reason}`,
      });

      try {
        await paymentService.capturePayment({
          paymentIntentId,
          orderId,
        });
      } catch (captureErr) {
        logger.error("admin.partial_refund.capture_failed", {
          orderId,
          error: String(captureErr),
        });
        throw captureErr;
      }
    });

    const refundDollars = formatCentsAsNzd(amountCents);

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
      summary: `Partial refund of ${refundDollars} issued to buyer. Reason: ${reason}`,
      metadata: {
        favour: "partial",
        refundAmount: amountCents,
        reason,
      },
    });

    fireAndForget(
      createNotification({
        userId: order.buyerId,
        type: "SYSTEM",
        title: "Dispute resolved — partial refund",
        body: `A partial refund of ${refundDollars} has been issued for "${order.listing.title}".`,
        orderId,
        link: `/orders/${orderId}`,
      }),
      "admin.dispute.partialRefund.notify.buyer",
      { orderId, userId: order.buyerId },
    );

    fireAndForget(
      createNotification({
        userId: order.sellerId,
        type: "SYSTEM",
        title: "Dispute resolved — partial refund to buyer",
        body: `A partial refund of ${refundDollars} was issued for "${order.listing.title}". The remaining balance will be released.`,
        orderId,
        link: `/orders/${orderId}`,
      }),
      "admin.dispute.partialRefund.notify.seller",
      { orderId, userId: order.sellerId },
    );

    logger.info("admin.dispute.partial_refund", {
      orderId,
      amountCents,
      adminUserId,
    });

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
                listingTitle: order.listing.title,
                resolution: "PARTIAL_REFUND",
                refundAmount: amountCents,
                adminNote: reason,
              }),
              "admin.dispute.partialRefund.email.buyer",
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
                listingTitle: order.listing.title,
                resolution: "PARTIAL_REFUND",
                refundAmount: amountCents,
                adminNote: reason,
              }),
              "admin.dispute.partialRefund.email.seller",
              { orderId },
            );
          }
        }),
      "admin.dispute.partialRefund.emailLookup",
      { orderId },
    );
  },

  async overrideAutoResolution(
    orderId: string,
    newDecision: "refund" | "dismiss" | "partial_refund",
    reason: string,
    adminUserId: string,
    partialAmountCents?: number,
  ): Promise<void> {
    const autoResEvent =
      await adminRepository.findLatestAutoResolvedEvent(orderId);

    const originalDecision = autoResEvent
      ? String(
          (autoResEvent.metadata as Record<string, unknown>).decision ?? "",
        )
      : "UNKNOWN";

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

    if (newDecision === "refund") {
      await adminDisputeService.resolveDispute(orderId, "buyer", adminUserId);
    } else if (newDecision === "dismiss") {
      await adminDisputeService.resolveDispute(orderId, "seller", adminUserId);
    } else if (newDecision === "partial_refund" && partialAmountCents) {
      await adminDisputeService.resolveDisputePartialRefund(
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
  },

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
      fireAndForget(
        createNotification({
          userId,
          type: "ORDER_DISPUTED",
          title: "More information requested",
          body: `Our team needs more information about the dispute on "${order.listing.title}": ${message}`,
          orderId,
          link: `/orders/${orderId}`,
        }),
        "admin.dispute.requestInfo.notify",
        { orderId, userId },
      );
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
  },
};
