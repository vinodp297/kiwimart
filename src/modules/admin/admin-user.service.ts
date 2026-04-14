// src/modules/admin/admin-user.service.ts
// ─── User management methods ──────────────────────────────────────────────────

import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { userRepository } from "@/modules/users/user.repository";
import { orderRepository } from "@/modules/orders/order.repository";
import { listingRepository } from "@/modules/listings/listing.repository";
import { adminRepository } from "./admin.repository";
import type { ReportAction } from "./admin.types";

export const adminUserService = {
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
  },

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
  },

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
  },

  async resolveReport(
    reportId: string,
    action: ReportAction,
    adminUserId: string,
  ): Promise<void> {
    const report = await adminRepository.findReportById(reportId);
    if (!report) throw AppError.notFound("Report");

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
  },

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
  },

  async getUserAdminInfo(userId: string) {
    return adminRepository.findUserAdminInfo(userId);
  },

  async getTeamMembers() {
    return adminRepository.findAdminTeamMembers();
  },

  async getModerationData() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [reports, resolvedToday, bannedUsers] = await Promise.all([
      adminRepository.findOpenReportsForModeration(50),
      adminRepository.countResolvedReports(todayStart),
      adminRepository.findBannedUsers(20),
    ]);

    return { reports, resolvedToday, bannedUsers };
  },

  async findAdminInvitation(tokenHash: string) {
    return adminRepository.findAdminInvitationByTokenHash(tokenHash);
  },

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
  },
};
