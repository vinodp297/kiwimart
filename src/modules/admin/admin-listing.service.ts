// src/modules/admin/admin-listing.service.ts
// ─── Listing moderation + business metrics + dashboard methods ────────────────

import { logger } from "@/shared/logger";
import { adminRepository } from "./admin.repository";

export const adminListingService = {
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
  },

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
  },

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
  },

  async getUserForVerification(userId: string) {
    return adminRepository.findUserWithVerificationApp(userId);
  },

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
  },

  async getDatabaseHealth() {
    return adminRepository.checkDatabaseHealth();
  },

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
  },

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
  },
};
