// src/app/(protected)/admin/page.tsx
// ─── Super Admin Master Dashboard ─────────────────────────────────────────────
import type React from "react";
import Link from "next/link";
import SystemHealthWidget from "@/components/admin/SystemHealthWidget";
import ApproveIdButton from "./ApproveIdButton";
import { requireAnyAdmin } from "@/shared/auth/requirePermission";
import db from "@/lib/db";
import { formatPrice } from "@/lib/utils";
import { OrderVolumeChart } from "@/components/admin/OrderVolumeChart";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin Dashboard" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requireAnyAdmin();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    newUsersToday,
    activeSellers,
    newSellersThisWeek,
    gmvAllTime,
    gmvThisMonth,
    completedOrders,
    pendingPayoutsCount,
    openDisputes,
    pendingReports,
    bannedUsers,
    pendingVerifications,
    activeListings,
    ordersToday,
    totalOrders,
    refundedOrders,
    last7DaysOrders,
    recentOrdersForChart,
    categoryStats,
    categories,
  ] = await Promise.all([
    db.user.count({ where: { isBanned: false } }),
    db.user.count({ where: { createdAt: { gte: todayStart } } }),
    db.user.count({ where: { sellerEnabled: true, isBanned: false } }),
    db.user.count({
      where: { sellerEnabled: true, createdAt: { gte: weekStart } },
    }),
    db.order.aggregate({
      _sum: { totalNzd: true },
      where: { status: "COMPLETED" },
    }),
    db.order.aggregate({
      _sum: { totalNzd: true },
      where: { status: "COMPLETED", completedAt: { gte: monthStart } },
    }),
    db.order.count({ where: { status: "COMPLETED" } }),
    db.payout.count({ where: { status: "PROCESSING" } }),
    db.order.count({ where: { status: "DISPUTED" } }),
    db.report.count({ where: { status: "OPEN" } }),
    db.user.count({ where: { isBanned: true } }),
    db.user.findMany({
      where: { idSubmittedAt: { not: null }, idVerified: false },
      select: { id: true, displayName: true, email: true, idSubmittedAt: true },
      orderBy: { idSubmittedAt: "asc" },
    }),
    db.listing.count({ where: { status: "ACTIVE" } }),
    db.order.count({ where: { createdAt: { gte: todayStart } } }),
    db.order.count(),
    db.order.count({ where: { status: "REFUNDED" } }),
    db.order.findMany({
      where: { status: "COMPLETED", completedAt: { gte: weekStart } },
      select: { completedAt: true, totalNzd: true },
      orderBy: { completedAt: "asc" },
    }),
    db.order.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.listing.groupBy({
      by: ["categoryId"],
      where: { status: "ACTIVE", deletedAt: null },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    db.category.findMany({ select: { id: true, name: true } }),
  ]);

  const completionRate =
    totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;
  const gmvAllTimeCents = gmvAllTime._sum?.totalNzd ?? 0;
  const gmvThisMonthCents = gmvThisMonth._sum?.totalNzd ?? 0;
  const avgOrderValue =
    completedOrders > 0 ? gmvAllTimeCents / completedOrders : 0;

  // Last 7 days revenue table
  const revenueByDay = new Map<string, { orders: number; gmv: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    revenueByDay.set(d.toISOString().slice(0, 10), { orders: 0, gmv: 0 });
  }
  for (const o of last7DaysOrders) {
    if (!o.completedAt) continue;
    const key = o.completedAt.toISOString().slice(0, 10);
    const existing = revenueByDay.get(key);
    if (existing) {
      existing.orders++;
      existing.gmv += o.totalNzd;
    }
  }
  const revenueRows = [...revenueByDay.entries()];

  // 30-day order volume chart
  const orderCountByDay: Record<string, number> = {};
  for (const o of recentOrdersForChart) {
    const key = o.createdAt.toISOString().slice(0, 10);
    orderCountByDay[key] = (orderCountByDay[key] ?? 0) + 1;
  }
  const orderChartDays: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    orderChartDays.push({ date: key, count: orderCountByDay[key] ?? 0 });
  }

  // Category breakdown
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const totalActiveListings = categoryStats.reduce(
    (s, c) => s + c._count.id,
    0,
  );

  type KpiSection = {
    title: string;
    items: {
      label: string;
      value: string;
      sub?: string;
      href?: string;
      alert?: boolean;
    }[];
  };
  const sections: KpiSection[] = [
    {
      title: "Users",
      items: [
        {
          label: "Total Users",
          value: totalUsers.toLocaleString("en-NZ"),
          sub: `+${newUsersToday} today`,
        },
        {
          label: "Active Sellers",
          value: activeSellers.toLocaleString("en-NZ"),
          sub: `+${newSellersThisWeek} this week`,
        },
        {
          label: "Banned Users",
          value: bannedUsers.toLocaleString("en-NZ"),
          alert: bannedUsers > 0,
        },
        {
          label: "Pending Verifications",
          value: pendingVerifications.length.toLocaleString("en-NZ"),
          href: "/admin/sellers",
          alert: pendingVerifications.length > 0,
        },
      ],
    },
    {
      title: "Transactions",
      items: [
        { label: "GMV All Time", value: formatPrice(gmvAllTimeCents / 100) },
        {
          label: "GMV This Month",
          value: formatPrice(gmvThisMonthCents / 100),
        },
        {
          label: "Completed Orders",
          value: completedOrders.toLocaleString("en-NZ"),
        },
        {
          label: "Pending Payouts",
          value: pendingPayoutsCount.toLocaleString("en-NZ"),
          alert: pendingPayoutsCount > 0,
        },
      ],
    },
    {
      title: "Trust & Safety",
      items: [
        {
          label: "Open Disputes",
          value: openDisputes.toLocaleString("en-NZ"),
          href: "/admin/disputes",
          alert: openDisputes > 0,
        },
        {
          label: "Pending Reports",
          value: pendingReports.toLocaleString("en-NZ"),
          href: "/admin/moderation",
          alert: pendingReports > 0,
        },
        {
          label: "Refunded Orders",
          value: refundedOrders.toLocaleString("en-NZ"),
        },
        { label: "Banned Users", value: bannedUsers.toLocaleString("en-NZ") },
      ],
    },
    {
      title: "Platform",
      items: [
        {
          label: "Active Listings",
          value: activeListings.toLocaleString("en-NZ"),
        },
        { label: "Orders Today", value: ordersToday.toLocaleString("en-NZ") },
        { label: "Completion Rate", value: `${completionRate}%` },
        { label: "Avg Order Value", value: formatPrice(avgOrderValue / 100) },
      ],
    },
  ];

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      <div className="bg-[#141414] text-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">⚡</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
              Admin Dashboard
            </h1>
          </div>
          <p className="text-white/50 text-[13.5px]">
            Welcome back, {admin.displayName}
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* 4 KPI sections */}
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-[11px] font-bold text-[#9E9A91] uppercase tracking-widest mb-3">
              {section.title}
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {section.items.map((item) => {
                const card = (
                  <div
                    className={`bg-white rounded-2xl border p-5 h-full ${item.alert ? "border-red-200 bg-red-50" : "border-[#E3E0D9]"} ${item.href ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
                  >
                    <p className="text-[12px] text-[#9E9A91] font-medium mb-1">
                      {item.label}
                    </p>
                    <p className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] leading-none">
                      {item.value}
                    </p>
                    {item.sub && (
                      <p className="text-[11px] text-[#9E9A91] mt-1">
                        {item.sub}
                      </p>
                    )}
                  </div>
                );
                return item.href ? (
                  <Link key={item.label} href={item.href} className="block">
                    {card}
                  </Link>
                ) : (
                  <div key={item.label}>{card}</div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Order volume chart */}
        <OrderVolumeChart data={orderChartDays} />

        {/* Revenue last 7 days */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-4">
            Revenue — Last 7 Days
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-[#F0EDE8]">
                  {["Date", "Orders", "GMV (NZD)"].map((h) => (
                    <th
                      key={h}
                      className="pb-2 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F8F7F4]">
                {revenueRows.map(([date, data]) => (
                  <tr key={date} className="hover:bg-[#FAFAF8]">
                    <td className="py-2.5 text-[#73706A]">
                      {new Date(date + "T00:00:00").toLocaleDateString(
                        "en-NZ",
                        { weekday: "short", day: "numeric", month: "short" },
                      )}
                    </td>
                    <td className="py-2.5 text-[#141414] font-medium">
                      {data.orders}
                    </td>
                    <td className="py-2.5 font-semibold text-[#141414]">
                      {formatPrice(data.gmv / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Category breakdown */}
        {categoryStats.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-4">
              Category Performance
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#F0EDE8]">
                    {["Category", "Active Listings", "% of Total"].map((h) => (
                      <th
                        key={h}
                        className="pb-2 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F8F7F4]">
                  {categoryStats.slice(0, 10).map((cat) => {
                    const pct =
                      totalActiveListings > 0
                        ? (cat._count.id / totalActiveListings) * 100
                        : 0;
                    return (
                      <tr key={cat.categoryId} className="hover:bg-[#FAFAF8]">
                        <td className="py-3 font-medium text-[#141414]">
                          {categoryMap[cat.categoryId] ?? cat.categoryId}
                        </td>
                        <td className="py-3 text-[#73706A]">
                          {cat._count.id.toLocaleString("en-NZ")}
                        </td>
                        <td className="py-3 w-48">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-[#F2EFE8] rounded-full">
                              <div
                                className="h-1.5 bg-[#D4A843] rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-[#9E9A91] w-10 text-right">
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pending ID Verifications */}
        {pendingVerifications.length > 0 && (
          <div className="bg-white rounded-2xl border border-amber-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">🪪</span>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
                Pending ID Verifications
              </h2>
              <span className="ml-auto text-[11.5px] bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                {pendingVerifications.length} pending
              </span>
            </div>
            <div className="divide-y divide-[#E3E0D9]">
              {pendingVerifications.map((u) => (
                <div key={u.id} className="flex items-center gap-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-[#141414] truncate">
                      {u.displayName ?? "(no name)"}
                    </p>
                    <p className="text-[12px] text-[#9E9A91] truncate">
                      {u.email}
                    </p>
                    <p className="text-[11.5px] text-[#C9C5BC]">
                      Submitted{" "}
                      {u.idSubmittedAt
                        ? new Date(u.idSubmittedAt).toLocaleDateString("en-NZ")
                        : "—"}
                    </p>
                  </div>
                  <ApproveIdButton userId={u.id} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions + System Health */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-4">
              Quick Actions
            </h2>
            <div className="flex flex-col gap-3">
              {[
                {
                  label: "Open Disputes",
                  href: "/admin/disputes",
                  icon: "⚖️",
                  badge: openDisputes,
                },
                {
                  label: "Pending Reports",
                  href: "/admin/moderation",
                  icon: "🚩",
                  badge: pendingReports,
                },
                {
                  label: "Pending Verifications",
                  href: "/admin/sellers",
                  icon: "🪪",
                  badge: pendingVerifications.length,
                },
                {
                  label: "Finance Overview",
                  href: "/admin/finance",
                  icon: "💰",
                  badge: 0,
                },
              ].map(({ label, href, icon, badge }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 p-4 rounded-xl border border-[#E3E0D9] hover:border-[#D4A843] hover:bg-[#F5ECD4]/30 transition-all duration-150"
                >
                  <span className="text-xl">{icon}</span>
                  <span className="text-[13.5px] font-semibold text-[#141414]">
                    {label}
                  </span>
                  {badge > 0 && (
                    <span className="ml-auto bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {badge}
                    </span>
                  )}
                  {!badge && (
                    <svg
                      className="ml-auto text-[#C9C5BC]"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  )}
                </Link>
              ))}
            </div>
          </div>
          <SystemHealthWidget />
        </div>
      </div>
    </div>
  );
}
