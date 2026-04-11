// src/modules/admin/admin.service.ts
// ─── Admin Service ───────────────────────────────────────────────────────────
// Admin-only operations. Framework-free. Takes adminUserId as parameter.

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
import type { ReportAction, DisputeFavour } from "./admin.types";

export class AdminService {
  async banUser(
    userId: string,
    reason: string,
    adminUserId: string,
  ): Promise<void> {
    await userRepository.transaction(async (tx) => {
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

    await userRepository.setSellerEnabled(userId, !user.isSellerEnabled);

    audit({
      userId: adminUserId,
      action: "ADMIN_ACTION",
      entityType: "User",
      entityId: userId,
      metadata: { action: "toggle_seller", newValue: !user.isSellerEnabled },
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
    await orderRepository.$transaction(async (tx) => {
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
          await orderRepository.$transaction(async (tx) => {
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
      // Fail-closed: Redis unavailable in production → surface retry message.
      // Check error code, not message string, to avoid brittle string matching.
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

    // Fire-and-forget dispute resolved emails to both parties
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

      // Capture the remaining amount (order total minus the partial refund)
      // so the seller receives what they are owed.
      try {
        await paymentService.capturePayment({
          paymentIntentId,
          orderId,
        });
      } catch (captureErr) {
        // Capture failure after a partial refund is a financial integrity gap —
        // the refund has moved money but the capture did not complete.
        // Log at ERROR so it surfaces in Sentry and the ops dashboard.
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

    // Fire-and-forget partial refund emails to both parties
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

  /** Aggregate business health metrics for the internal dashboard. */
  async getBusinessMetrics() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      newUsersToday,
      activeListings,
      totalOrders,
      ordersToday,
      completedOrders,
      disputedOrders,
      pendingReports,
      pendingPayouts,
      revenueResult,
      revenueThisWeek,
    ] = await Promise.all([
      adminRepository.countUsers(),
      adminRepository.countUsers({ createdAt: { gte: todayStart } }),
      adminRepository.countActiveListings(),
      adminRepository.countOrders({}),
      adminRepository.countOrders({ createdAt: { gte: todayStart } }),
      adminRepository.countOrders({ status: "COMPLETED" }),
      adminRepository.countOrders({ status: "DISPUTED" }),
      adminRepository.countOpenReports(),
      adminRepository.countProcessingPayouts(),
      adminRepository.aggregateRevenue(new Date(0), new Date()),
      adminRepository.aggregateRevenue(weekStart, new Date()),
    ]);

    return {
      users: {
        total: totalUsers,
        newToday: newUsersToday,
      },
      listings: {
        active: activeListings,
      },
      orders: {
        total: totalOrders,
        today: ordersToday,
        completed: completedOrders,
        disputed: disputedOrders,
        completionRate:
          totalOrders > 0
            ? Math.round((completedOrders / totalOrders) * 100)
            : 0,
      },
      disputes: {
        pending: disputedOrders,
      },
      reports: {
        pending: pendingReports,
      },
      payouts: {
        pending: pendingPayouts,
      },
      revenue: {
        totalNzd: revenueResult._sum.totalNzd ?? 0,
        thisWeekNzd: revenueThisWeek._sum.totalNzd ?? 0,
      },
    };
  }
  // ─── Team management ───────────────────────────────────────────────────────

  /** Get admin details for auth check on team page. */
  async getUserAdminInfo(userId: string) {
    return adminRepository.findUserAdminInfo(userId);
  }

  /** List all admin team members. */
  async getTeamMembers() {
    return adminRepository.findAdminTeamMembers();
  }

  // ─── Moderation dashboard ─────────────────────────────────────────────────

  /** Fetch moderation dashboard data (open reports, resolved count, banned users). */
  async getModerationData() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [reports, resolvedToday, bannedUsers] = await Promise.all([
      adminRepository.findOpenReportsForModeration(50),
      adminRepository.countResolvedReports(todayStart),
      adminRepository.findBannedUsers(20),
    ]);

    return { reports, resolvedToday, bannedUsers };
  }

  // ── Page data methods (called by page.tsx Server Components) ─────────────

  /** All data needed by the admin master dashboard page. */
  async getDashboardData() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const results = await Promise.allSettled([
      adminRepository.countUsers({ isBanned: false }),
      adminRepository.countUsers({ createdAt: { gte: todayStart } }),
      adminRepository.countUsers({ isSellerEnabled: true, isBanned: false }),
      adminRepository.countUsers({
        isSellerEnabled: true,
        createdAt: { gte: weekStart },
      }),
      adminRepository.aggregateRevenue(new Date(0), new Date()),
      adminRepository.aggregateRevenue(monthStart, new Date()),
      adminRepository.countOrders({ status: "COMPLETED" }),
      adminRepository.countProcessingPayouts(),
      adminRepository.countOrders({ status: "DISPUTED" }),
      adminRepository.countOpenReports(),
      adminRepository.countUsers({ isBanned: true }),
      adminRepository.findPendingIdVerifications(),
      adminRepository.countActiveListings(),
      adminRepository.countOrders({ createdAt: { gte: todayStart } }),
      adminRepository.countOrders({}),
      adminRepository.countOrders({ status: "REFUNDED" }),
      adminRepository.findCompletedOrdersSince(weekStart),
      adminRepository.findOrdersCreatedSince(thirtyDaysAgo),
      adminRepository.findListingCategoryStats(),
      adminRepository.findCategoryNames(),
    ]);

    function val<T>(r: PromiseSettledResult<T>, fallback: T): T {
      return r.status === "fulfilled" ? r.value : fallback;
    }
    const emptyAggregate = { _sum: { totalNzd: null } };

    return {
      totalUsers: val(results[0], 0),
      newUsersToday: val(results[1], 0),
      activeSellers: val(results[2], 0),
      newSellersThisWeek: val(results[3], 0),
      gmvAllTime: val(results[4], emptyAggregate),
      gmvThisMonth: val(results[5], emptyAggregate),
      completedOrders: val(results[6], 0),
      pendingPayoutsCount: val(results[7], 0),
      openDisputes: val(results[8], 0),
      pendingReports: val(results[9], 0),
      bannedUsers: val(results[10], 0),
      pendingVerifications: val(
        results[11],
        [] as {
          id: string;
          displayName: string;
          email: string;
          idSubmittedAt: Date | null;
        }[],
      ),
      activeListings: val(results[12], 0),
      ordersToday: val(results[13], 0),
      totalOrders: val(results[14], 0),
      refundedOrders: val(results[15], 0),
      last7DaysOrders: val(
        results[16],
        [] as { completedAt: Date | null; totalNzd: number }[],
      ),
      recentOrdersForChart: val(results[17], [] as { createdAt: Date }[]),
      categoryStats: val(
        results[18],
        [] as { categoryId: string; _count: { id: number } }[],
      ),
      categories: val(results[19], [] as { id: string; name: string }[]),
    };
  }

  /** All data needed by the seller management page. */
  async getSellerManagementData() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const [
      pendingVerifications,
      verifiedToday,
      activeSellers,
      newSellersThisWeek,
      sellers,
    ] = await Promise.all([
      adminRepository.findPendingVerificationsDetailed(),
      adminRepository.countVerifiedSince(todayStart),
      adminRepository.countUsers({ isSellerEnabled: true, isBanned: false }),
      adminRepository.countUsers({
        isSellerEnabled: true,
        createdAt: { gte: weekStart },
      }),
      adminRepository.findAllSellers(50),
    ]);

    return {
      pendingVerifications,
      verifiedToday,
      activeSellers,
      newSellersThisWeek,
      sellers,
    };
  }

  /** User + verification application for the ID review page. */
  async getUserForVerification(userId: string) {
    return adminRepository.findUserWithVerificationApp(userId);
  }

  /** Cron log statuses for the system status page. */
  async getCronJobStatuses(
    jobs: { name: string; schedule: string; scheduleLabel: string }[],
  ) {
    try {
      const rows = await adminRepository.findCronLogs(
        jobs.map((j) => j.name),
        200,
      );
      const byJob = new Map<string, { startedAt: Date; status: string }>();
      for (const row of rows) {
        if (!byJob.has(row.jobName)) {
          byJob.set(row.jobName, {
            startedAt: row.startedAt,
            status: row.status,
          });
        }
      }
      return jobs.map((job) => {
        const last = byJob.get(job.name);
        return {
          name: job.name,
          scheduleLabel: job.scheduleLabel,
          lastRunAt: last ? last.startedAt : null,
          lastStatus: last ? (last.status as "success" | "error") : null,
        };
      });
    } catch {
      logger.warn("admin.getCronJobStatuses.failed", {});
      return jobs.map((job) => ({
        name: job.name,
        scheduleLabel: job.scheduleLabel,
        lastRunAt: null,
        lastStatus: null,
      }));
    }
  }

  /** Database health check for the system status page. */
  async getDatabaseHealth() {
    return adminRepository.checkDatabaseHealth();
  }

  /** All data needed by the finance dashboard page. */
  async getFinanceDashboard() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      gmvToday,
      gmvWeek,
      gmvMonth,
      gmvYear,
      completedOrders,
      gmvAll,
      pendingPayoutsCount,
      pendingPayoutsAgg,
      refundsMonthCount,
      refundsMonthAgg,
      totalOrdersMonth,
      failedPayouts,
      transactions,
      pendingPayouts,
      refundedOrders,
      dailyOrdersRaw,
      topSellersGrouped,
    ] = await Promise.all([
      adminRepository.aggregateOrderRevenue({
        status: "COMPLETED",
        completedAt: { gte: todayStart },
      }),
      adminRepository.aggregateOrderRevenue({
        status: "COMPLETED",
        completedAt: { gte: weekStart },
      }),
      adminRepository.aggregateOrderRevenue({
        status: "COMPLETED",
        completedAt: { gte: monthStart },
      }),
      adminRepository.aggregateOrderRevenue({
        status: "COMPLETED",
        completedAt: { gte: yearStart },
      }),
      adminRepository.countOrders({ status: "COMPLETED" }),
      adminRepository.aggregateOrderRevenue({ status: "COMPLETED" }),
      adminRepository.countPayouts({ status: "PROCESSING" }),
      adminRepository.aggregatePayoutAmount({ status: "PROCESSING" }),
      adminRepository.countOrders({
        status: "REFUNDED",
        updatedAt: { gte: monthStart },
      }),
      adminRepository.aggregateOrderRevenue({
        status: "REFUNDED",
        updatedAt: { gte: monthStart },
      }),
      adminRepository.countOrders({ createdAt: { gte: monthStart } }),
      adminRepository.countPayouts({ status: "FAILED" }),
      adminRepository.findCompletedOrdersWithRelations(50),
      adminRepository.findProcessingPayoutsWithRelations(100),
      adminRepository.findRefundedOrdersWithRelations(100),
      adminRepository.findCompletedOrdersSince(thirtyDaysAgo),
      adminRepository.findTopSellersByRevenue(10),
    ]);

    const sellerIds = topSellersGrouped.map((s) => s.sellerId);
    const sellerUsers = await adminRepository.findSellerInfo(sellerIds);

    return {
      gmvToday,
      gmvWeek,
      gmvMonth,
      gmvYear,
      completedOrders,
      gmvAll,
      pendingPayoutsCount,
      pendingPayoutsAgg,
      refundsMonthCount,
      refundsMonthAgg,
      totalOrdersMonth,
      failedPayouts,
      transactions,
      pendingPayouts,
      refundedOrders,
      dailyOrdersRaw,
      topSellersGrouped,
      sellerUsers,
    };
  }

  /** Audit log page data with filtering and pagination. */
  async getAuditLogs(params: {
    page: number;
    actionFilter?: string;
    dateFrom?: string;
    dateTo?: string;
    userSearch?: string;
  }) {
    const PAGE_SIZE = 50;
    const { page, actionFilter, dateFrom, dateTo, userSearch } = params;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: import("@prisma/client").Prisma.AuditLogWhereInput = {};
    if (actionFilter) {
      where.action = actionFilter as import("@prisma/client").AuditAction;
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (userSearch) {
      where.user = {
        OR: [
          { displayName: { contains: userSearch, mode: "insensitive" } },
          { email: { contains: userSearch, mode: "insensitive" } },
        ],
      };
    }

    const [auditLogs, totalCount, kpis, actionTypesRaw] = await Promise.all([
      adminRepository.findAuditLogsWithUser(
        where,
        (page - 1) * PAGE_SIZE,
        PAGE_SIZE,
      ),
      adminRepository.countAuditLogs(where),
      adminRepository.getAuditKpisSince(today),
      adminRepository.groupAuditLogsByAction(),
    ]);

    return {
      auditLogs,
      totalCount,
      totalPages: Math.ceil(totalCount / PAGE_SIZE),
      kpis,
      actionTypes: actionTypesRaw.map((a) => ({
        action: a.action,
        count: a._count.id,
      })),
    };
  }

  /** Find admin invitation by token hash (for accept-invite page). */
  async findAdminInvitation(tokenHash: string) {
    return adminRepository.findAdminInvitationByTokenHash(tokenHash);
  }

  /** Grant admin role from an accepted invitation. */
  async grantAdminRoleFromInvite(
    userId: string,
    invitationId: string,
    adminRole: string,
  ): Promise<void> {
    await adminRepository.grantAdminRoleFromInvite(
      userId,
      invitationId,
      adminRole,
    );
  }
}

export const adminService = new AdminService();
