// src/app/(protected)/admin/sellers/page.tsx
// ─── Seller Manager Dashboard ─────────────────────────────────────────────────
import Link from 'next/link';
import { requirePermission } from '@/shared/auth/requirePermission';
import db from '@/lib/db';
import ApproveIdButton from '../ApproveIdButton';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sellers — Admin' };
export const dynamic = 'force-dynamic';

export default async function SellersPage() {
  await requirePermission('VIEW_SELLERS');

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7); weekStart.setHours(0, 0, 0, 0);

  const [pendingVerifications, verifiedToday, activeSellers, newSellersThisWeek, sellers] = await Promise.all([
    db.user.findMany({
      where: { idSubmittedAt: { not: null }, idVerified: false, isBanned: false },
      select: {
        id: true, email: true, displayName: true, idSubmittedAt: true,
        sellerTermsAcceptedAt: true, stripeOnboarded: true, createdAt: true,
        phoneVerified: true,
      },
      orderBy: { idSubmittedAt: 'asc' },
    }),
    db.user.count({ where: { idVerified: true, idSubmittedAt: { gte: todayStart } } }),
    db.user.count({ where: { sellerEnabled: true, isBanned: false } }),
    db.user.count({ where: { sellerEnabled: true, createdAt: { gte: weekStart } } }),
    db.user.findMany({
      where: { sellerEnabled: true },
      select: {
        id: true, email: true, displayName: true, idVerified: true,
        phoneVerified: true, stripeOnboarded: true, createdAt: true,
        sellerEnabled: true,
        _count: { select: { listings: true, sellerOrders: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  const TIER_LABELS: Record<string, { label: string; color: string }> = {
    id_verified: { label: 'ID Verified', color: 'bg-[#F5ECD4] text-[#8B6914]' },
    phone_verified: { label: 'Phone Verified', color: 'bg-sky-50 text-sky-700' },
    basic: { label: 'Basic', color: 'bg-[#F8F7F4] text-[#9E9A91]' },
  };

  function getTier(s: typeof sellers[0]) {
    if (s.idVerified) return 'id_verified';
    if (s.phoneVerified) return 'phone_verified';
    return 'basic';
  }

  const kpis = [
    { label: 'Pending Verifications', value: pendingVerifications.length.toString(), alert: pendingVerifications.length > 0 },
    { label: 'Verified Today', value: verifiedToday.toString() },
    { label: 'Active Sellers', value: activeSellers.toLocaleString('en-NZ') },
    { label: 'New This Week', value: newSellersThisWeek.toString() },
  ];

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      <div className="bg-[#141414] text-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <Link href="/admin" className="hover:text-white">Admin</Link>
            <span>/</span>
            <span className="text-white">Sellers</span>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">🏪</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">Seller Management</h1>
          </div>
          <p className="text-white/50 text-[13.5px]">Seller verification and performance</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(({ label, value, alert }) => (
            <div key={label} className={`bg-white rounded-2xl border p-5 ${alert ? 'border-amber-200 bg-amber-50' : 'border-[#E3E0D9]'}`}>
              <p className="text-[12px] text-[#9E9A91] font-medium mb-1">{label}</p>
              <p className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] leading-none">{value}</p>
            </div>
          ))}
        </div>

        {/* Pending Verifications */}
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
              {pendingVerifications.map(u => (
                <div key={u.id} className="flex items-start gap-4 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-[#141414]">{u.displayName}</p>
                    <p className="text-[12px] text-[#9E9A91]">{u.email}</p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {u.phoneVerified && <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">📱 Phone verified</span>}
                      {u.stripeOnboarded && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">💳 Stripe connected</span>}
                      {u.sellerTermsAcceptedAt && <span className="text-[10px] font-semibold text-[#73706A] bg-[#F8F7F4] px-2 py-0.5 rounded-full">✓ Terms accepted</span>}
                    </div>
                    <p className="text-[11px] text-[#C9C5BC] mt-1">
                      Submitted {u.idSubmittedAt ? new Date(u.idSubmittedAt).toLocaleDateString('en-NZ') : '—'}
                    </p>
                  </div>
                  <ApproveIdButton userId={u.id} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All sellers table */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9]">
          <div className="p-5 border-b border-[#F0EDE8]">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
              All Sellers ({sellers.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                  {['Seller', 'Email', 'Tier', 'Listings', 'Orders', 'Stripe', 'Joined'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F8F7F4]">
                {sellers.map(s => {
                  const tier = getTier(s);
                  const { label, color } = TIER_LABELS[tier];
                  return (
                    <tr key={s.id} className="hover:bg-[#FAFAF8]">
                      <td className="px-4 py-3 font-semibold text-[#141414]">{s.displayName}</td>
                      <td className="px-4 py-3 text-[#73706A]">{s.email}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${color}`}>{label}</span>
                      </td>
                      <td className="px-4 py-3 text-[#73706A]">{s._count.listings}</td>
                      <td className="px-4 py-3 text-[#73706A]">{s._count.sellerOrders}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.stripeOnboarded ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F8F7F4] text-[#9E9A91]'}`}>
                          {s.stripeOnboarded ? '✓ Connected' : 'Not set up'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#9E9A91] whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                    </tr>
                  );
                })}
                {sellers.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-[#9E9A91]">No sellers yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
