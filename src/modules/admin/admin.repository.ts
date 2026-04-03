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
    listing: { select: { id: true; title: true } };
    reportedUser: { select: { id: true; displayName: true } };
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
    // TODO: move from src/app/api/admin/users/route.ts
    throw new Error("Not implemented");
  },

  /** Count total users (for admin stats).
   * @source src/app/(protected)/admin/page.tsx */
  async countUsers(where?: Prisma.UserWhereInput): Promise<number> {
    // TODO: move from src/app/(protected)/admin/page.tsx
    throw new Error("Not implemented");
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
    // TODO: move from src/app/api/admin/reports/route.ts
    throw new Error("Not implemented");
  },

  /** Find a report by ID.
   * @source src/modules/admin/admin.service.ts */
  async findReportById(id: string): Promise<ReportWithRelations | null> {
    // TODO: move from src/modules/admin/admin.service.ts
    throw new Error("Not implemented");
  },

  /** Resolve a report (inside a transaction).
   * @source src/modules/admin/admin.service.ts */
  async resolveReport(
    id: string,
    resolvedBy: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // TODO: move from src/modules/admin/admin.service.ts
    throw new Error("Not implemented");
  },

  // -------------------------------------------------------------------------
  // Metrics / KPIs  (used by admin dashboard pages)
  // -------------------------------------------------------------------------

  /** Total revenue aggregate for a period.
   * @source src/app/(protected)/admin/finance/page.tsx */
  async aggregateRevenue(
    from: Date,
    to: Date,
  ): Promise<{ _sum: { platformFeeNzd: number | null } }> {
    // TODO: move from src/app/(protected)/admin/finance/page.tsx
    throw new Error("Not implemented");
  },

  /** Count orders by status for a period.
   * @source src/app/(protected)/admin/page.tsx, finance/page.tsx */
  async countOrders(where: Prisma.OrderWhereInput): Promise<number> {
    // TODO: move from src/app/(protected)/admin/page.tsx
    throw new Error("Not implemented");
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
    // TODO: move from src/app/(protected)/admin/audit/page.tsx
    throw new Error("Not implemented");
  },

  /** Count audit log entries.
   * @source src/app/(protected)/admin/audit/page.tsx */
  async countAuditLogs(where: Prisma.AuditLogWhereInput): Promise<number> {
    // TODO: move from src/app/(protected)/admin/audit/page.tsx
    throw new Error("Not implemented");
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
    // TODO: move from src/modules/admin/admin.service.ts
    throw new Error("Not implemented");
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
    // TODO: move from src/modules/admin/admin-disputes.service.ts
    throw new Error("Not implemented");
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
    // TODO: move from src/modules/admin/admin.service.ts
    throw new Error("Not implemented");
  },
};
