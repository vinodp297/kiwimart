// src/app/(protected)/admin/finance/page.tsx
// ─── Finance Admin Dashboard ──────────────────────────────────────────────────
// TODO POST-LAUNCH: Move aggregates to dedicated metrics service with caching.
// See architectural review 27-Mar-2026.
import Link from 'next/link';
import { requirePermission } from '@/shared/auth/requirePermission';
import db from '@/lib/db';
import { formatPrice } from '@/lib/utils';
import ExportCSV from './ExportCSV';
import { RevenueChart } from '@/components/admin/RevenueChart';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Finance — Admin' };
export const dynamic = 'force-dynamic';

export default async function FinancePage() {
  await requirePermission('VIEW_REVENUE');

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7); weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    gmvToday, gmvWeek, gmvMonth, gmvYear,
    completedOrders, gmvAll, pendingPayoutsCount, pendingPayoutsAgg,
    refundsMonthCount, refundsMonthAgg, totalOrdersMonth, failedPayouts,
    transactions, pendingPayouts, refundedOrders, dailyOrdersRaw,
  ] = await Promise.all([
    db.order.aggregate({ _sum: { totalNzd: true }, where: { status: 'COMPLETED', completedAt: { gte: todayStart } } }),
    db.order.aggregate({ _sum: { totalNzd: true }, where: { status: 'COMPLETED', completedAt: { gte: weekStart } } }),
    db.order.aggregate({ _sum: { totalNzd: true }, where: { status: 'COMPLETED', completedAt: { gte: monthStart } } }),
    db.order.aggregate({ _sum: { totalNzd: true }, where: { status: 'COMPLETED', completedAt: { gte: yearStart } } }),
    db.order.count({ where: { status: 'COMPLETED' } }),
    db.order.aggregate({ _sum: { totalNzd: true }, where: { status: 'COMPLETED' } }),
    db.payout.count({ where: { status: 'PROCESSING' } }),
    db.payout.aggregate({ _sum: { amountNzd: true }, where: { status: 'PROCESSING' } }),
    db.order.count({ where: { status: 'REFUNDED', updatedAt: { gte: monthStart } } }),
    db.order.aggregate({ _sum: { totalNzd: true }, where: { status: 'REFUNDED', updatedAt: { gte: monthStart } } }),
    db.order.count({ where: { createdAt: { gte: monthStart } } }),
    db.payout.count({ where: { status: 'FAILED' } }),
    db.order.findMany({
      where: { status: 'COMPLETED' },
      include: {
        listing: { select: { title: true } },
        buyer: { select: { displayName: true } },
        seller: { select: { displayName: true } },
        payout: { select: { status: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 50,
    }),
    db.payout.findMany({
      where: { status: 'PROCESSING' },
      include: {
        order: {
          include: {
            seller: { select: { displayName: true, email: true } },
            listing: { select: { title: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    db.order.findMany({
      where: { status: 'REFUNDED' },
      include: {
        listing: { select: { title: true } },
        buyer: { select: { displayName: true } },
        seller: { select: { displayName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    db.order.findMany({
      where: { status: 'COMPLETED', completedAt: { gte: thirtyDaysAgo } },
      select: { completedAt: true, totalNzd: true },
      orderBy: { completedAt: 'asc' },
    }),
  ]);

  // Build 30-day revenue chart data
  const dailyRevenueMap = dailyOrdersRaw.reduce((acc, order) => {
    const day = order.completedAt?.toISOString().slice(0, 10) ?? 'unknown';
    acc[day] = (acc[day] ?? 0) + order.totalNzd;
    return acc;
  }, {} as Record<string, number>);

  const revenueChartDays: { date: string; revenue: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    revenueChartDays.push({ date: key, revenue: dailyRevenueMap[key] ?? 0 });
  }

  // Top 10 sellers by revenue
  const topSellersGrouped = await db.order.groupBy({
    by: ['sellerId'],
    where: { status: 'COMPLETED' },
    _sum: { totalNzd: true },
    _count: { id: true },
    orderBy: { _sum: { totalNzd: 'desc' } },
    take: 10,
  });

  const sellerIds = topSellersGrouped.map(s => s.sellerId);
  const sellerUsers = await db.user.findMany({
    where: { id: { in: sellerIds } },
    select: { id: true, displayName: true, email: true, idVerified: true },
  });
  const sellerMap = Object.fromEntries(sellerUsers.map(s => [s.id, s]));

  const avgOrderValue = completedOrders > 0 ? (gmvAll._sum.totalNzd ?? 0) / completedOrders : 0;
  const refundRate = totalOrdersMonth > 0 ? ((refundsMonthCount / totalOrdersMonth) * 100).toFixed(1) : '0.0';

  const kpiRows = [
    [
      { label: 'GMV Today', value: formatPrice((gmvToday._sum.totalNzd ?? 0) / 100) },
      { label: 'GMV This Week', value: formatPrice((gmvWeek._sum.totalNzd ?? 0) / 100) },
      { label: 'GMV This Month', value: formatPrice((gmvMonth._sum.totalNzd ?? 0) / 100) },
      { label: 'GMV This Year', value: formatPrice((gmvYear._sum.totalNzd ?? 0) / 100) },
    ],
    [
      { label: 'Completed Orders', value: completedOrders.toLocaleString('en-NZ') },
      { label: 'Avg Order Value', value: formatPrice(avgOrderValue / 100) },
      { label: 'Pending Payouts', value: pendingPayoutsCount.toLocaleString('en-NZ') },
      { label: 'Pending Payout $', value: formatPrice((pendingPayoutsAgg._sum.amountNzd ?? 0) / 100) },
    ],
    [
      { label: 'Refunds This Month', value: refundsMonthCount.toLocaleString('en-NZ') },
      { label: 'Refund Value', value: formatPrice((refundsMonthAgg._sum.totalNzd ?? 0) / 100) },
      { label: 'Refund Rate', value: `${refundRate}%`, alert: parseFloat(refundRate) > 5 },
      { label: 'Failed Payouts', value: failedPayouts.toLocaleString('en-NZ'), alert: failedPayouts > 0 },
    ],
  ];

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      <div className="bg-[#141414] text-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <Link href="/admin" className="hover:text-white">Admin</Link>
            <span>/</span>
            <span className="text-white">Finance</span>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">💰</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">Finance</h1>
          </div>
          <p className="text-white/50 text-[13.5px]">Revenue, payouts and transaction overview</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* KPI rows */}
        {kpiRows.map((row, i) => (
          <div key={i} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {row.map(({ label, value, alert }) => (
              <div key={label} className={`bg-white rounded-2xl border p-5 ${alert ? 'border-red-200 bg-red-50' : 'border-[#E3E0D9]'}`}>
                <p className="text-[12px] text-[#9E9A91] font-medium mb-1">{label}</p>
                <p className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] leading-none">{value}</p>
              </div>
            ))}
          </div>
        ))}

        {/* Revenue chart */}
        <RevenueChart data={revenueChartDays} />

        {/* Top sellers */}
        {topSellersGrouped.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#E3E0D9]">
            <div className="p-5 border-b border-[#F0EDE8]">
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">Top 10 Sellers by Revenue</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                    {['Rank', 'Seller', 'Verified', 'Orders', 'Revenue'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F8F7F4]">
                  {topSellersGrouped.map((s, idx) => {
                    const seller = sellerMap[s.sellerId];
                    return (
                      <tr key={s.sellerId} className="hover:bg-[#FAFAF8]">
                        <td className="px-4 py-3 font-semibold text-[#9E9A91]">#{idx + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#141414]">{seller?.displayName ?? 'Unknown'}</p>
                          <p className="text-[11px] text-[#9E9A91]">{seller?.email ?? ''}</p>
                        </td>
                        <td className="px-4 py-3">
                          {seller?.idVerified ? (
                            <span className="text-[11px] font-semibold text-emerald-600">✓ Verified</span>
                          ) : (
                            <span className="text-[11px] text-[#9E9A91]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[#141414] font-medium">{s._count.id}</td>
                        <td className="px-4 py-3 font-semibold text-[#141414]">{formatPrice((s._sum.totalNzd ?? 0) / 100)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Transactions table */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9]">
          <div className="flex items-center justify-between p-5 border-b border-[#F0EDE8]">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
              Recent Transactions
            </h2>
            <ExportCSV
              transactions={transactions.map(t => ({
                id: t.id,
                completedAt: t.completedAt,
                listingTitle: t.listing.title,
                buyerName: t.buyer.displayName,
                sellerName: t.seller.displayName,
                totalNzd: t.totalNzd,
                payoutStatus: t.payout?.status,
              }))}
              payouts={pendingPayouts.map(p => ({
                id: p.id,
                amountNzd: p.amountNzd,
                status: p.status,
                initiatedAt: p.initiatedAt,
                stripeTransferId: p.stripeTransferId,
                sellerName: p.order.seller.displayName,
                sellerEmail: p.order.seller.email,
                listingTitle: p.order.listing.title,
              }))}
              refunds={refundedOrders.map(r => ({
                id: r.id,
                updatedAt: r.updatedAt,
                listingTitle: r.listing.title,
                buyerName: r.buyer.displayName,
                sellerName: r.seller.displayName,
                totalNzd: r.totalNzd,
              }))}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                  {['Order ID', 'Date', 'Item', 'Buyer', 'Seller', 'Amount', 'Payout'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F8F7F4]">
                {transactions.map(t => (
                  <tr key={t.id} className="hover:bg-[#FAFAF8]">
                    <td className="px-4 py-3 font-mono text-[11px] text-[#9E9A91]">{t.id.slice(0, 10)}…</td>
                    <td className="px-4 py-3 text-[#73706A] whitespace-nowrap">
                      {t.completedAt ? new Date(t.completedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[#141414] max-w-[160px] truncate">{t.listing.title}</td>
                    <td className="px-4 py-3 text-[#73706A]">{t.buyer.displayName}</td>
                    <td className="px-4 py-3 text-[#73706A]">{t.seller.displayName}</td>
                    <td className="px-4 py-3 font-semibold text-[#141414]">{formatPrice(t.totalNzd / 100)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        t.payout?.status === 'PAID' ? 'bg-emerald-50 text-emerald-700' :
                        t.payout?.status === 'PROCESSING' ? 'bg-amber-50 text-amber-700' :
                        t.payout?.status === 'FAILED' ? 'bg-red-50 text-red-700' :
                        'bg-[#F8F7F4] text-[#9E9A91]'
                      }`}>
                        {t.payout?.status ?? 'N/A'}
                      </span>
                    </td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-[#9E9A91]">No completed transactions yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pending payouts */}
        {pendingPayouts.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#E3E0D9]">
            <div className="p-5 border-b border-[#F0EDE8]">
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
                Pending Payouts
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                    {['Payout ID', 'Seller', 'Amount', 'Item', 'Initiated', 'Stripe Transfer'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F8F7F4]">
                  {pendingPayouts.map(p => (
                    <tr key={p.id} className="hover:bg-[#FAFAF8]">
                      <td className="px-4 py-3 font-mono text-[11px] text-[#9E9A91]">{p.id.slice(0, 10)}…</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#141414]">{p.order.seller.displayName}</p>
                        <p className="text-[11px] text-[#9E9A91]">{p.order.seller.email}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#141414]">{formatPrice(p.amountNzd / 100)}</td>
                      <td className="px-4 py-3 text-[#73706A] max-w-[140px] truncate">{p.order.listing.title}</td>
                      <td className="px-4 py-3 text-[#9E9A91] whitespace-nowrap">
                        {p.initiatedAt ? new Date(p.initiatedAt).toLocaleDateString('en-NZ') : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[#9E9A91] truncate max-w-[120px]">
                        {p.stripeTransferId ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
