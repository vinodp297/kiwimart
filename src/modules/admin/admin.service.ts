// src/modules/admin/admin.service.ts (barrel — under 50 lines)
// ─── Re-exports from focused sub-files ───────────────────────────────────────

import { adminUserService } from "./admin-user.service";
import { adminListingService } from "./admin-listing.service";
import { adminDisputeService } from "./admin-dispute.service";

const adminServiceObject = {
  ...adminUserService,
  ...adminListingService,
  ...adminDisputeService,
};

// Preserve class-style interface callers expect
export class AdminService {
  banUser = adminUserService.banUser.bind(adminUserService);
  unbanUser = adminUserService.unbanUser.bind(adminUserService);
  toggleSellerEnabled =
    adminUserService.toggleSellerEnabled.bind(adminUserService);
  resolveReport = adminUserService.resolveReport.bind(adminUserService);
  flagUserForFraud = adminUserService.flagUserForFraud.bind(adminUserService);
  getUserAdminInfo = adminUserService.getUserAdminInfo.bind(adminUserService);
  getTeamMembers = adminUserService.getTeamMembers.bind(adminUserService);
  getModerationData = adminUserService.getModerationData.bind(adminUserService);
  findAdminInvitation =
    adminUserService.findAdminInvitation.bind(adminUserService);
  grantAdminRoleFromInvite =
    adminUserService.grantAdminRoleFromInvite.bind(adminUserService);
  getBusinessMetrics =
    adminListingService.getBusinessMetrics.bind(adminListingService);
  getDashboardData =
    adminListingService.getDashboardData.bind(adminListingService);
  getSellerManagementData =
    adminListingService.getSellerManagementData.bind(adminListingService);
  getUserForVerification =
    adminListingService.getUserForVerification.bind(adminListingService);
  getCronJobStatuses =
    adminListingService.getCronJobStatuses.bind(adminListingService);
  getDatabaseHealth =
    adminListingService.getDatabaseHealth.bind(adminListingService);
  getFinanceDashboard =
    adminListingService.getFinanceDashboard.bind(adminListingService);
  getAuditLogs = adminListingService.getAuditLogs.bind(adminListingService);
  resolveDispute = adminDisputeService.resolveDispute.bind(adminDisputeService);
  resolveDisputePartialRefund =
    adminDisputeService.resolveDisputePartialRefund.bind(adminDisputeService);
  overrideAutoResolution =
    adminDisputeService.overrideAutoResolution.bind(adminDisputeService);
  requestMoreInfo =
    adminDisputeService.requestMoreInfo.bind(adminDisputeService);
}

export const adminService = new AdminService();

export { adminServiceObject };
