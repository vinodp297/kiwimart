import { db, getClient } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Admin repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/modules/admin/admin.service.ts
//   - src/modules/admin/admin-disputes.service.ts
//   - src/app/(protected)/admin/page.tsx  (metrics queries)
//   - src/app/(protected)/admin/finance/page.tsx
//   - src/app/(protected)/admin/audit/page.tsx
//   - src/app/api/admin/users/route.ts
//   - src/app/api/admin/reports/route.ts
// ---------------------------------------------------------------------------

export type AdminUserRow = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    displayName: true;
    username: true;
    isBanned: true;
    isSellerEnabled: true;
    isAdmin: true;
    createdAt: true;
  };
}>;

export type ReportWithRelations = Prisma.ReportGetPayload<{
  include: {
    reporter: { select: { id: true; displayName: true } };
    targetUser: { select: { id: true; displayName: true } };
  };
}>;

/** Fields needed by the admin layout shell (sidebar + auth guard). */
export type AdminLayoutUser = {
  isAdmin: boolean;
  adminRole: string | null;
  displayName: string | null;
  email: string | null;
  isMfaEnabled: boolean;
};

/** Fetch the minimal user fields required by the admin layout component. */
export async function getAdminLayoutUser(
  userId: string,
): Promise<AdminLayoutUser | null> {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      isAdmin: true,
      adminRole: true,
      displayName: true,
      email: true,
      isMfaEnabled: true,
    },
  });
}

export const adminRepository = {
  // -------------------------------------------------------------------------
  // User management
  // -------------------------------------------------------------------------

  /** Paginated admin user list with search. */
  async findUsers(
    query: string | null,
    take: number,
    cursor?: string,
  ): Promise<AdminUserRow[]> {
    const where: Prisma.UserWhereInput = query
      ? {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { username: { contains: query, mode: "insensitive" } },
          ],
        }
      : {};
    return db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        email: true,
        displayName: true,
        username: true,
        isBanned: true,
        isSellerEnabled: true,
        isAdmin: true,
        createdAt: true,
      },
    });
  },

  /** Count total users (for admin stats). */
  async countUsers(where?: Prisma.UserWhereInput): Promise<number> {
    return db.user.count({ where });
  },

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  /** Fetch open reports (admin queue, paginated). */
  async findOpenReports(
    take: number,
    cursor?: string,
  ): Promise<ReportWithRelations[]> {
    return db.report.findMany({
      where: { status: "OPEN" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        reporter: { select: { id: true, displayName: true } },
        targetUser: { select: { id: true, displayName: true } },
      },
    });
  },

  /** Find a report by ID. */
  async findReportById(id: string): Promise<ReportWithRelations | null> {
    return db.report.findUnique({
      where: { id },
      include: {
        reporter: { select: { id: true, displayName: true } },
        targetUser: { select: { id: true, displayName: true } },
      },
    });
  },

  /** Resolve a report (inside a transaction). */
  async resolveReport(
    id: string,
    resolvedBy: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.report.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy,
      },
    });
  },

  // -------------------------------------------------------------------------
  // Metrics / KPIs  (used by admin dashboard pages)
  // -------------------------------------------------------------------------

  /** Total revenue aggregate for a period. */
  async aggregateRevenue(
    from: Date,
    to: Date,
  ): Promise<{ _sum: { totalNzd: number | null } }> {
    return db.order.aggregate({
      _sum: { totalNzd: true },
      where: {
        status: "COMPLETED",
        completedAt: { gte: from, lte: to },
      },
    });
  },

  /** Count orders by status for a period. */
  async countOrders(where: Prisma.OrderWhereInput): Promise<number> {
    return db.order.count({ where });
  },

  /** Audit log entries (paginated + filtered). */
  async findAuditLogs(
    where: Prisma.AuditLogWhereInput,
    take: number,
    cursor?: string,
  ): Promise<
    Prisma.AuditLogGetPayload<{
      select: {
        id: true;
        action: true;
        userId: true;
        createdAt: true;
        metadata: true;
      };
    }>[]
  > {
    return db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        action: true,
        userId: true,
        createdAt: true,
        metadata: true,
      },
    });
  },

  /** Count audit log entries. */
  async countAuditLogs(where: Prisma.AuditLogWhereInput): Promise<number> {
    return db.auditLog.count({ where });
  },

  // -------------------------------------------------------------------------
  // Trust metrics
  // -------------------------------------------------------------------------

  /** Upsert trust metrics for fraud flagging. */
  async upsertTrustMetrics(
    userId: string,
    data: Prisma.TrustMetricsUpdateInput,
  ): Promise<void> {
    await db.trustMetrics.upsert({
      where: { userId },
      create: {
        userId,
        totalOrders: 0,
        completedOrders: 0,
        disputeCount: 0,
        disputeRate: 0,
        disputesLast30Days: 0,
        dispatchPhotoRate: 0,
        accountAgeDays: 0,
        lastComputedAt: new Date(),
      },
      update: data,
    });
  },

  /** Find non-banned dispute admin user IDs for escalation notifications. */
  async findDisputeAdmins(): Promise<{ id: string }[]> {
    return db.user.findMany({
      where: {
        isAdmin: true,
        adminRole: { in: ["DISPUTES_ADMIN", "SUPER_ADMIN"] },
        isBanned: false,
      },
      select: { id: true },
    });
  },

  /** Record a seller dispute (pickup-auto-refund path) via trust metrics upsert.
   * Increments disputeCount + disputesLast30Days and optionally flags for fraud. */
  async recordSellerDisputeFromPickup(
    sellerId: string,
    isFraudSignal: boolean,
  ): Promise<void> {
    await db.trustMetrics.upsert({
      where: { userId: sellerId },
      create: {
        userId: sellerId,
        totalOrders: 0,
        completedOrders: 0,
        disputeCount: 1,
        disputeRate: 0,
        disputesLast30Days: 1,
        averageResponseHours: null,
        averageRating: null,
        dispatchPhotoRate: 0,
        accountAgeDays: 0,
        isFlaggedForFraud: isFraudSignal,
        lastComputedAt: new Date(),
      },
      update: {
        disputeCount: { increment: 1 },
        disputesLast30Days: { increment: 1 },
        ...(isFraudSignal ? { isFlaggedForFraud: true } : {}),
      },
    });
  },

  /** Flag a user for fraud (upsert trust metrics with isFlaggedForFraud=true). */
  async flagUserForFraud(userId: string): Promise<void> {
    await db.trustMetrics.upsert({
      where: { userId },
      create: {
        userId,
        totalOrders: 0,
        completedOrders: 0,
        disputeCount: 0,
        disputeRate: 0,
        disputesLast30Days: 0,
        averageResponseHours: null,
        averageRating: null,
        dispatchPhotoRate: 0,
        accountAgeDays: 0,
        isFlaggedForFraud: true,
        lastComputedAt: new Date(),
      },
      update: { isFlaggedForFraud: true },
    });
  },

  // -------------------------------------------------------------------------
  // Payout management
  // -------------------------------------------------------------------------

  /** Update payouts for an order (seller win / refund scenarios). */
  async updateOrderPayouts(
    orderId: string,
    data: Prisma.PayoutUpdateManyMutationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.payout.updateMany({ where: { orderId }, data });
  },

  // -------------------------------------------------------------------------
  // Order events (auto-resolution)
  // -------------------------------------------------------------------------

  /** Find the most recent AUTO_RESOLVED event that carries a decision in its metadata. */
  async findLatestAutoResolvedEvent(
    orderId: string,
  ): Promise<Prisma.OrderEventGetPayload<{
    select: { metadata: true };
  }> | null> {
    return db.orderEvent.findFirst({
      where: {
        orderId,
        type: "AUTO_RESOLVED",
        metadata: { path: ["decision"], not: { equals: null } },
      },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
  },

  /** Find an order event (used by auto-resolution checks). */
  async findOrderEvent(
    orderId: string,
    type: string,
  ): Promise<Prisma.OrderEventGetPayload<{
    select: { id: true; metadata: true; createdAt: true };
  }> | null> {
    return db.orderEvent.findFirst({
      where: { orderId, type },
      orderBy: { createdAt: "desc" },
      select: { id: true, metadata: true, createdAt: true },
    });
  },

  /** Count active (non-deleted) listings. */
  async countActiveListings(): Promise<number> {
    return db.listing.count({ where: { status: "ACTIVE", deletedAt: null } });
  },

  /** Count open reports. */
  async countOpenReports(): Promise<number> {
    return db.report.count({ where: { status: "OPEN" } });
  },

  /** Count payouts in PROCESSING state. */
  async countProcessingPayouts(): Promise<number> {
    return db.payout.count({ where: { status: "PROCESSING" } });
  },

  /** Open reports with cursor pagination — matches /api/admin/reports shape.
   * reporter.username matches the route's existing include shape. */
  async findOpenReportsCursor(limit: number, cursor?: string) {
    return db.report.findMany({
      where: { status: "OPEN" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        reporter: { select: { username: true } },
      },
    });
  },

  /** Page-based user list with search — matches /api/admin/users shape. */
  async findUsersByPage(q: string | null, page: number) {
    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" as const } },
            { username: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

    return db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      skip: (page - 1) * 20,
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        region: true,
        isSellerEnabled: true,
        idVerified: true,
        isBanned: true,
        createdAt: true,
        _count: {
          select: { listings: true, buyerOrders: true },
        },
      },
    });
  },

  // -------------------------------------------------------------------------
  // Team management
  // -------------------------------------------------------------------------

  /** Find the current user's admin details (for team page auth check). */
  async findUserAdminInfo(userId: string) {
    return db.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true, adminRole: true },
    });
  },

  /** List all admin team members ordered by creation date. */
  async findAdminTeamMembers() {
    return db.user.findMany({
      where: { isAdmin: true },
      select: {
        id: true,
        email: true,
        displayName: true,
        adminRole: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
  },

  // -------------------------------------------------------------------------
  // Moderation dashboard
  // -------------------------------------------------------------------------

  /** Open reports with full reporter/target details (moderation queue). */
  async findOpenReportsForModeration(take: number) {
    return db.report.findMany({
      where: { status: "OPEN" },
      include: {
        reporter: { select: { displayName: true, email: true } },
        targetUser: {
          select: { displayName: true, email: true, isBanned: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take,
    });
  },

  /** Count reports resolved since a given date. */
  async countResolvedReports(since: Date): Promise<number> {
    return db.report.count({ where: { resolvedAt: { gte: since } } });
  },

  /** Banned users for the moderation dashboard. */
  async findBannedUsers(take: number) {
    return db.user.findMany({
      where: { isBanned: true },
      select: {
        id: true,
        email: true,
        displayName: true,
        bannedAt: true,
        bannedReason: true,
      },
      orderBy: { bannedAt: "desc" },
      take,
    });
  },

  /** Disputed orders with cursor pagination — matches /api/admin/disputes shape. */
  async findDisputedOrdersCursor(limit: number, cursor?: string) {
    return db.order.findMany({
      where: { status: "DISPUTED" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        buyer: { select: { username: true, email: true } },
        seller: { select: { username: true, email: true } },
        listing: { select: { title: true } },
      },
      orderBy: { updatedAt: "asc" },
    });
  },

  /**
   * Aggregate the daily-digest counters used by the admin daily summary
   * email cron. Single repository call so the cron file does not need to
   * import @/lib/db just to issue counts.
   */
  async getDailyDigestMetrics(since: Date): Promise<{
    newUsers: number;
    newOrders: number;
    completedOrders: number;
    newDisputes: number;
    gmvTotalNzd: number;
    newSellers: number;
  }> {
    const [newUsers, newOrders, completedOrders, newDisputes, gmv, newSellers] =
      await Promise.all([
        db.user.count({ where: { createdAt: { gte: since } } }),
        db.order.count({ where: { createdAt: { gte: since } } }),
        db.order.count({
          where: { status: "COMPLETED", completedAt: { gte: since } },
        }),
        db.order.count({
          where: { status: "DISPUTED", updatedAt: { gte: since } },
        }),
        db.order.aggregate({
          where: { status: "COMPLETED", completedAt: { gte: since } },
          _sum: { totalNzd: true },
        }),
        db.user.count({
          where: { isSellerEnabled: true, createdAt: { gte: since } },
        }),
      ]);
    return {
      newUsers,
      newOrders,
      completedOrders,
      newDisputes,
      gmvTotalNzd: gmv._sum.totalNzd ?? 0,
      newSellers,
    };
  },

  /**
   * Find all super-admin users for system notifications and digest emails.
   */
  async findSuperAdmins(): Promise<
    Array<{ email: string | null; displayName: string | null }>
  > {
    return db.user.findMany({
      where: { adminRole: "SUPER_ADMIN" },
      select: { email: true, displayName: true },
    });
  },

  // ── Dashboard page methods ────────────────────────────────────────────────

  /** Pending ID verifications (slim select for admin dashboard). */
  async findPendingIdVerifications(): Promise<
    {
      id: string;
      displayName: string;
      email: string;
      idSubmittedAt: Date | null;
    }[]
  > {
    return db.user.findMany({
      where: { idSubmittedAt: { not: null }, idVerified: false },
      select: { id: true, displayName: true, email: true, idSubmittedAt: true },
      orderBy: { idSubmittedAt: "asc" },
    });
  },

  /** Completed orders since a date (for 7-day revenue table). */
  async findCompletedOrdersSince(
    since: Date,
  ): Promise<{ completedAt: Date | null; totalNzd: number }[]> {
    return db.order.findMany({
      where: { status: "COMPLETED", completedAt: { gte: since } },
      select: { completedAt: true, totalNzd: true },
      orderBy: { completedAt: "asc" },
    });
  },

  /** Orders created since a date (for volume chart). */
  async findOrdersCreatedSince(since: Date): Promise<{ createdAt: Date }[]> {
    return db.order.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  },

  /** Active listing counts grouped by category. */
  async findListingCategoryStats() {
    return db.listing.groupBy({
      by: ["categoryId"],
      where: { status: "ACTIVE", deletedAt: null },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });
  },

  /** All categories (id + name). */
  async findCategoryNames(): Promise<{ id: string; name: string }[]> {
    return db.category.findMany({ select: { id: true, name: true } });
  },

  // ── Seller management page methods ────────────────────────────────────────

  /** Pending verifications with full seller fields (for sellers page). */
  async findPendingVerificationsDetailed(): Promise<
    {
      id: string;
      email: string;
      displayName: string;
      idSubmittedAt: Date | null;
      sellerTermsAcceptedAt: Date | null;
      isStripeOnboarded: boolean;
      createdAt: Date;
      isPhoneVerified: boolean;
    }[]
  > {
    return db.user.findMany({
      where: {
        idSubmittedAt: { not: null },
        idVerified: false,
        isBanned: false,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        idSubmittedAt: true,
        sellerTermsAcceptedAt: true,
        isStripeOnboarded: true,
        createdAt: true,
        isPhoneVerified: true,
      },
      orderBy: { idSubmittedAt: "asc" },
    });
  },

  /** Count users whose idVerified date is on or after `since`. */
  async countVerifiedSince(since: Date): Promise<number> {
    return db.user.count({
      where: { idVerified: true, idSubmittedAt: { gte: since } },
    });
  },

  /** All sellers (limited) for the seller management table. */
  async findAllSellers(take: number) {
    return db.user.findMany({
      where: { isSellerEnabled: true },
      select: {
        id: true,
        email: true,
        displayName: true,
        idVerified: true,
        isPhoneVerified: true,
        isStripeOnboarded: true,
        createdAt: true,
        isSellerEnabled: true,
        _count: { select: { listings: true, sellerOrders: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  // ── Verification review page ──────────────────────────────────────────────

  /** Fetch a user + their verification application for the review page. */
  async findUserWithVerificationApp(userId: string) {
    return db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        email: true,
        username: true,
        isPhoneVerified: true,
        idVerified: true,
        idSubmittedAt: true,
        createdAt: true,
        verificationApplication: true,
      },
    });
  },

  // ── System health page ────────────────────────────────────────────────────

  /** Fetch recent cron log entries for the given job names. */
  async findCronLogs(
    jobNames: string[],
    take: number,
  ): Promise<{ jobName: string; startedAt: Date; status: string }[]> {
    return db.cronLog.findMany({
      where: { jobName: { in: jobNames } },
      orderBy: { startedAt: "desc" },
      take,
      select: { jobName: true, startedAt: true, status: true },
    });
  },

  /** Raw database health check — returns true if reachable. */
  async checkDatabaseHealth(): Promise<{ latencyMs: number; ok: boolean }> {
    const start = Date.now();
    try {
      await db.$queryRaw`SELECT 1`;
      return { latencyMs: Date.now() - start, ok: true };
    } catch {
      return { latencyMs: Date.now() - start, ok: false };
    }
  },

  // ── Finance page methods ──────────────────────────────────────────────────

  /** Aggregate order revenue for arbitrary where clause. */
  async aggregateOrderRevenue(
    where: Prisma.OrderWhereInput,
  ): Promise<{ _sum: { totalNzd: number | null } }> {
    return db.order.aggregate({ _sum: { totalNzd: true }, where });
  },

  /** Aggregate payout amount for arbitrary where clause. */
  async aggregatePayoutAmount(
    where: Prisma.PayoutWhereInput,
  ): Promise<{ _sum: { amountNzd: number | null } }> {
    return db.payout.aggregate({ _sum: { amountNzd: true }, where });
  },

  /** Count payouts matching where clause. */
  async countPayouts(where: Prisma.PayoutWhereInput): Promise<number> {
    return db.payout.count({ where });
  },

  /** Completed orders with buyer/seller/listing relations (transactions table). */
  async findCompletedOrdersWithRelations(take: number) {
    return db.order.findMany({
      where: { status: "COMPLETED" },
      include: {
        listing: { select: { title: true } },
        buyer: { select: { displayName: true } },
        seller: { select: { displayName: true } },
        payout: { select: { status: true } },
      },
      orderBy: { completedAt: "desc" },
      take,
    });
  },

  /** Processing payouts with order/seller/listing relations. */
  async findProcessingPayoutsWithRelations(take: number) {
    return db.payout.findMany({
      where: { status: "PROCESSING" },
      include: {
        order: {
          include: {
            seller: { select: { displayName: true, email: true } },
            listing: { select: { title: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take,
    });
  },

  /** Refunded orders with buyer/seller/listing relations. */
  async findRefundedOrdersWithRelations(take: number) {
    return db.order.findMany({
      where: { status: "REFUNDED" },
      include: {
        listing: { select: { title: true } },
        buyer: { select: { displayName: true } },
        seller: { select: { displayName: true } },
      },
      orderBy: { updatedAt: "desc" },
      take,
    });
  },

  /** Top sellers by completed order revenue. */
  async findTopSellersByRevenue(take: number) {
    return db.order.groupBy({
      by: ["sellerId"],
      where: { status: "COMPLETED" },
      _sum: { totalNzd: true },
      _count: { id: true },
      orderBy: { _sum: { totalNzd: "desc" } },
      take,
    });
  },

  /** Fetch display info for a list of seller IDs. */
  async findSellerInfo(
    ids: string[],
  ): Promise<
    { id: string; displayName: string; email: string; idVerified: boolean }[]
  > {
    if (ids.length === 0) return [];
    return db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, email: true, idVerified: true },
    });
  },

  // ── Audit log page methods ─────────────────────────────────────────────────

  /** Audit logs with user include (for the audit log table). */
  async findAuditLogsWithUser(
    where: Prisma.AuditLogWhereInput,
    skip: number,
    take: number,
  ) {
    return db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        user: {
          select: { displayName: true, email: true, adminRole: true },
        },
      },
    });
  },

  /** Group audit log entries by action (for filter dropdown). */
  async groupAuditLogsByAction() {
    return db.auditLog.groupBy({
      by: ["action"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });
  },

  /** Audit KPI counts since a given date. */
  async getAuditKpisSince(since: Date): Promise<{
    actionsToday: number;
    bannedToday: number;
    disputesResolvedToday: number;
    sellersApprovedToday: number;
  }> {
    const [
      actionsToday,
      bannedToday,
      disputesResolvedToday,
      sellersApprovedToday,
    ] = await Promise.all([
      db.auditLog.count({ where: { createdAt: { gte: since } } }),
      db.auditLog.count({
        where: { action: "ADMIN_ACTION", createdAt: { gte: since } },
      }),
      db.auditLog.count({
        where: { action: "DISPUTE_RESOLVED", createdAt: { gte: since } },
      }),
      db.auditLog.count({
        where: {
          action: "ADMIN_ACTION",
          entityType: "ID_VERIFICATION",
          createdAt: { gte: since },
        },
      }),
    ]);
    return {
      actionsToday,
      bannedToday,
      disputesResolvedToday,
      sellersApprovedToday,
    };
  },

  // ── Admin invite methods ──────────────────────────────────────────────────

  /** Find an admin invitation by its SHA-256 token hash. */
  async findAdminInvitationByTokenHash(tokenHash: string) {
    return db.adminInvitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        email: true,
        adminRole: true,
        expiresAt: true,
        acceptedAt: true,
        inviter: { select: { displayName: true } },
      },
    });
  },

  /** Grant admin role and mark invitation as accepted (atomic transaction). */
  async grantAdminRoleFromInvite(
    userId: string,
    invitationId: string,
    adminRole: string,
  ): Promise<void> {
    await db.$transaction([
      db.user.update({
        where: { id: userId },
        data: {
          isAdmin: true,
          adminRole: adminRole as import("@prisma/client").AdminRole,
        },
      }),
      db.adminInvitation.update({
        where: { id: invitationId },
        data: { acceptedAt: new Date() },
      }),
    ]);
  },
};
