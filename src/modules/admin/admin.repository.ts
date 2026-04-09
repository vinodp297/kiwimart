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
};
