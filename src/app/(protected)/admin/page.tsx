// src/app/(protected)/admin/page.tsx  (Sprint 12 — Observability)
// ─── Admin KPI Dashboard ───────────────────────────────────────────────────────

import type React from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import SystemHealthWidget from '@/components/admin/SystemHealthWidget';
import ApproveIdButton from './ApproveIdButton';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { formatPrice } from '@/lib/utils';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Admin Dashboard — KiwiMart' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await auth();
  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
  if (!isAdmin) redirect('/dashboard/buyer');

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    totalListings,
    totalOrders,
    ordersToday,
    pendingDisputes,
    pendingReports,
    completedOrders,
    revenueAgg,
    revenueThisWeekAgg,
    pendingIdVerifications,
  ] = await Promise.all([
    db.user.count(),
    db.listing.count({ where: { status: 'ACTIVE' } }),
    db.order.count(),
    db.order.count({ where: { createdAt: { gte: todayStart } } }),
    db.order.count({ where: { status: 'DISPUTED' } }),
    db.report.count({ where: { status: 'OPEN' } }),
    db.order.count({ where: { status: 'COMPLETED' } }),
    db.order.aggregate({
      _sum: { totalNzd: true },
      where: { status: 'COMPLETED' },
    }),
    db.order.aggregate({
      _sum: { totalNzd: true },
      where: { status: 'COMPLETED', completedAt: { gte: weekStart } },
    }),
    db.user.findMany({
      where: { idSubmittedAt: { not: null }, idVerified: false },
      select: { id: true, displayName: true, email: true, idSubmittedAt: true },
      orderBy: { idSubmittedAt: 'asc' },
    }),
  ]);

  const totalRevenueCents = revenueAgg._sum.totalNzd ?? 0;
  const revenueThisWeekCents = revenueThisWeekAgg._sum.totalNzd ?? 0;
  const completionRate =
    totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;

  type Kpi = {
    label: string;
    value: string;
    subValue?: string;
    icon: React.ReactNode;
    alert: boolean;
    alertColour?: string;
    href?: string;
    badge?: string;
  };
  const kpis: Kpi[] = [
    {
      label: 'Total Users',
      value: totalUsers.toLocaleString('en-NZ'),
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
      alert: false,
    },
    {
      label: 'Active Listings',
      value: totalListings.toLocaleString('en-NZ'),
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      ),
      alert: false,
    },
    {
      label: 'Total Orders',
      value: totalOrders.toLocaleString('en-NZ'),
      subValue: `${ordersToday} today`,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M16.5 9.4 7.55 4.24" />
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.29 7 12 12 20.71 7" />
          <line x1="12" y1="22" x2="12" y2="12" />
        </svg>
      ),
      alert: false,
    },
    {
      label: 'Completion Rate',
      value: `${completionRate}%`,
      subValue: `${completedOrders.toLocaleString('en-NZ')} completed`,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ),
      alert: false,
    },
    {
      label: 'Pending Disputes',
      value: pendingDisputes.toLocaleString('en-NZ'),
      href: '/admin/disputes',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ),
      alert: pendingDisputes > 0,
      alertColour: 'text-red-600 bg-red-50 border-red-200',
      badge: pendingDisputes > 0 ? 'Needs attention' : undefined,
    },
    {
      label: 'Pending Reports',
      value: pendingReports.toLocaleString('en-NZ'),
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      ),
      alert: pendingReports > 0,
      alertColour: 'text-amber-700 bg-amber-50 border-amber-200',
    },
    {
      label: 'Total Revenue',
      value: formatPrice(totalRevenueCents / 100),
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
      alert: false,
    },
    {
      label: 'Revenue This Week',
      value: formatPrice(revenueThisWeekCents / 100),
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      ),
      alert: false,
    },
  ];

  const quickActions = [
    { label: 'Manage Users', href: '/admin/users', icon: '👤' },
    { label: 'Review Reports', href: '/admin/reports', icon: '🚩' },
    { label: 'Resolve Disputes', href: '/admin/disputes', icon: '⚖️' },
  ];

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        {/* Header band */}
        <div className="bg-[#141414] text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[#D4A843] text-xl">⚡</span>
              <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
                Admin Dashboard
              </h1>
            </div>
            <p className="text-white/50 text-[13.5px]">KiwiMart platform management</p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {kpis.map(({ label, value, subValue, icon, alert, alertColour, href, badge }) => {
              const card = (
                <div
                  className={`bg-white rounded-2xl border p-5 h-full ${
                    alert ? (alertColour ?? 'border-[#E3E0D9]') : 'border-[#E3E0D9]'
                  } ${href ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2 rounded-xl ${alert ? '' : 'bg-[#F8F7F4]'} text-[#73706A]`}>
                      {icon}
                    </div>
                    {badge && (
                      <span className="text-[10px] font-semibold bg-red-600 text-white px-2 py-0.5 rounded-full">
                        {badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[#9E9A91] font-medium mb-1">{label}</p>
                  <p className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] leading-none">
                    {value}
                  </p>
                  {subValue && (
                    <p className="text-[11px] text-[#9E9A91] mt-1">{subValue}</p>
                  )}
                </div>
              );
              return href ? (
                <Link key={label} href={href} className="block">
                  {card}
                </Link>
              ) : (
                <div key={label}>{card}</div>
              );
            })}
          </div>

          {/* Pending ID Verifications */}
          {pendingIdVerifications.length > 0 && (
            <div className="bg-white rounded-2xl border border-amber-200 p-6 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">🪪</span>
                <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
                  Pending ID Verifications
                </h2>
                <span className="ml-auto text-[11.5px] bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                  {pendingIdVerifications.length} pending
                </span>
              </div>
              <div className="divide-y divide-[#E3E0D9]">
                {pendingIdVerifications.map(u => (
                  <div key={u.id} className="flex items-center gap-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold text-[#141414] truncate">
                        {u.displayName ?? '(no name)'}
                      </p>
                      <p className="text-[12px] text-[#9E9A91] truncate">{u.email}</p>
                      <p className="text-[11.5px] text-[#C9C5BC]">
                        Submitted {u.idSubmittedAt ? new Date(u.idSubmittedAt).toLocaleDateString('en-NZ') : '—'}
                      </p>
                    </div>
                    <ApproveIdButton userId={u.id} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions + System Health side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Quick Actions */}
            <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-4">
                Quick Actions
              </h2>
              <div className="flex flex-col gap-3">
                {quickActions.map(({ label, href, icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 p-4 rounded-xl border border-[#E3E0D9]
                      hover:border-[#D4A843] hover:bg-[#F5ECD4]/30 transition-all duration-150"
                  >
                    <span className="text-xl">{icon}</span>
                    <span className="text-[13.5px] font-semibold text-[#141414]">{label}</span>
                    <svg className="ml-auto text-[#C9C5BC]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </Link>
                ))}
              </div>
            </div>

            {/* System Health — auto-refreshes every 60s */}
            <SystemHealthWidget />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
