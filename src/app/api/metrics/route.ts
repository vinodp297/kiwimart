// src/app/api/metrics/route.ts
// ─── Business Metrics Endpoint ───────────────────────────────────────────────
// Admin-only endpoint returning business health metrics for the internal
// dashboard. Requires an active admin session.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { logger } from '@/shared/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Admin only
  const session = await auth();
  const user = session?.user as
    | { id: string; isAdmin?: boolean }
    | undefined;

  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 403 });
  }

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
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: todayStart } } }),
    db.listing.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    db.order.count(),
    db.order.count({ where: { createdAt: { gte: todayStart } } }),
    db.order.count({ where: { status: 'COMPLETED' } }),
    db.order.count({ where: { status: 'DISPUTED' } }),
    db.report.count({ where: { status: 'OPEN' } }),
    db.payout.count({ where: { status: 'PROCESSING' } }),
    db.order.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { totalNzd: true },
    }),
    db.order.aggregate({
      where: { status: 'COMPLETED', completedAt: { gte: weekStart } },
      _sum: { totalNzd: true },
    }),
  ]);

  const metrics = {
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

  logger.info('metrics.requested', { requestedBy: user.id });

  return NextResponse.json({
    success: true,
    data: metrics,
    timestamp: new Date().toISOString(),
  });
}
