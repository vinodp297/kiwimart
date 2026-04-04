import { db } from "@/lib/db";
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
    sellerEnabled: true;
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

export const adminRepository = {
  // -------------------------------------------------------------------------
  // User management
  // -------------------------------------------------------------------------

  /** Paginated admin user list with search.
   * @source src/app/api/admin/users/route.ts */
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
        sellerEnabled: true,
        isAdmin: true,
        createdAt: true,
      },
    });
  },

  /** Count total users (for admin stats).
   * @source src/app/(protected)/admin/page.tsx */
  async countUsers(where?: Prisma.UserWhereInput): Promise<number> {
    return db.user.count({ where });
  },

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  /** Fetch open reports (admin queue, paginated).
   * @source src/app/api/admin/reports/route.ts */
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

  /** Find a report by ID.
   * @source src/modules/admin/admin.service.ts */
  async findReportById(id: string): Promise<ReportWithRelations | null> {
    return db.report.findUnique({
      where: { id },
      include: {
        reporter: { select: { id: true, displayName: true } },
        targetUser: { select: { id: true, displayName: true } },
      },
    });
  },

  /** Resolve a report (inside a transaction).
   * @source src/modules/admin/admin.service.ts */
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

  /** Total revenue aggregate for a period.
   * @source src/app/(protected)/admin/finance/page.tsx */
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

  /** Count orders by status for a period.
   * @source src/app/(protected)/admin/page.tsx, finance/page.tsx */
  async countOrders(where: Prisma.OrderWhereInput): Promise<number> {
    return db.order.count({ where });
  },

  /** Audit log entries (paginated + filtered).
   * @source src/app/(protected)/admin/audit/page.tsx */
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

  /** Count audit log entries.
   * @source src/app/(protected)/admin/audit/page.tsx */
  async countAuditLogs(where: Prisma.AuditLogWhereInput): Promise<number> {
    return db.auditLog.count({ where });
  },

  // -------------------------------------------------------------------------
  // Trust metrics
  // -------------------------------------------------------------------------

  /** Upsert trust metrics for fraud flagging.
   * @source src/modules/admin/admin.service.ts */
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

  // -------------------------------------------------------------------------
  // Payout management
  // -------------------------------------------------------------------------

  /** Update payouts for an order (seller win / refund scenarios).
   * @source src/modules/admin/admin-disputes.service.ts */
  async updateOrderPayouts(
    orderId: string,
    data: Prisma.PayoutUpdateManyMutationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? db;
    await client.payout.updateMany({ where: { orderId }, data });
  },

  // -------------------------------------------------------------------------
  // Order events (auto-resolution)
  // -------------------------------------------------------------------------

  /** Find an order event (used by auto-resolution checks).
   * @source src/modules/admin/admin.service.ts */
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
};
