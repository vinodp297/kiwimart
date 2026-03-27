// src/app/(protected)/admin/moderation/page.tsx
// ─── Trust & Safety / Moderation Dashboard ───────────────────────────────────
import Link from 'next/link';
import { requirePermission } from '@/shared/auth/requirePermission';
import db from '@/lib/db';
import type { Metadata } from 'next';
import ModerationActions from './ModerationActions';

export const metadata: Metadata = { title: 'Moderation — Admin' };
export const dynamic = 'force-dynamic';

const REASON_LABELS: Record<string, string> = {
  SCAM: 'Scam', COUNTERFEIT: 'Counterfeit', PROHIBITED: 'Prohibited content',
  OFFENSIVE: 'Offensive content', SPAM: 'Spam', OTHER: 'Other',
};

export default async function ModerationPage() {
  await requirePermission('VIEW_REPORTS');

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [reports, resolvedToday, bannedUsers] = await Promise.all([
    db.report.findMany({
      where: { status: 'OPEN' },
      include: {
        reporter: { select: { displayName: true, email: true } },
        targetUser: { select: { displayName: true, email: true, isBanned: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    db.report.count({ where: { resolvedAt: { gte: todayStart } } }),
    db.user.findMany({
      where: { isBanned: true },
      select: { id: true, email: true, displayName: true, bannedAt: true, bannedReason: true },
      orderBy: { bannedAt: 'desc' },
      take: 20,
    }),
  ]);

  const pendingReports = reports.length;

  const kpis = [
    { label: 'Pending Reports', value: pendingReports.toString(), alert: pendingReports > 0 },
    { label: 'Resolved Today', value: resolvedToday.toString() },
    { label: 'Banned Users', value: bannedUsers.length.toString() },
    { label: 'Queue', value: `${Math.min(pendingReports, 50)} shown` },
  ];

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      <div className="bg-[#141414] text-white">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <Link href="/admin" className="hover:text-white">Admin</Link>
            <span>/</span>
            <span className="text-white">Moderation</span>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">🛡️</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">Trust & Safety</h1>
          </div>
          <p className="text-white/50 text-[13.5px]">Content moderation and user reports</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(({ label, value, alert }) => (
            <div key={label} className={`bg-white rounded-2xl border p-5 ${alert ? 'border-amber-200 bg-amber-50' : 'border-[#E3E0D9]'}`}>
              <p className="text-[12px] text-[#9E9A91] font-medium mb-1">{label}</p>
              <p className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] leading-none">{value}</p>
            </div>
          ))}
        </div>

        {/* Reports queue */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9]">
          <div className="p-5 border-b border-[#F0EDE8]">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
              Pending Reports
            </h2>
          </div>
          {reports.length === 0 ? (
            <div className="p-12 text-center text-[#9E9A91] text-[13px]">No pending reports 🎉</div>
          ) : (
            <div className="divide-y divide-[#F8F7F4]">
              {reports.map(r => (
                <div key={r.id} className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        {REASON_LABELS[r.reason] ?? r.reason}
                      </span>
                      {r.listingId && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                          Listing
                        </span>
                      )}
                      {r.targetUserId && !r.listingId && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                          User
                        </span>
                      )}
                      <span className="text-[11px] text-[#9E9A91]">
                        {new Date(r.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3 text-[12.5px]">
                    <div>
                      <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-1">Reporter</p>
                      <p className="font-semibold text-[#141414]">{r.reporter.displayName}</p>
                      <p className="text-[#73706A]">{r.reporter.email}</p>
                    </div>
                    {r.targetUser && (
                      <div>
                        <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-1">Reported User</p>
                        <p className="font-semibold text-[#141414]">{r.targetUser.displayName}</p>
                        <p className="text-[#73706A]">{r.targetUser.email}</p>
                        {r.targetUser.isBanned && <span className="text-[10px] text-red-600 font-semibold">Already banned</span>}
                      </div>
                    )}
                  </div>
                  {r.description && (
                    <p className="text-[12.5px] text-[#73706A] italic mb-3 bg-[#F8F7F4] rounded-lg p-2">
                      &ldquo;{r.description}&rdquo;
                    </p>
                  )}
                  <ModerationActions
                    reportId={r.id}
                    hasListing={!!r.listingId}
                    hasTargetUser={!!r.targetUserId}
                    targetAlreadyBanned={r.targetUser?.isBanned ?? false}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Banned users */}
        {bannedUsers.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#E3E0D9]">
            <div className="p-5 border-b border-[#F0EDE8]">
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
                Banned Users
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                    {['User', 'Email', 'Banned', 'Reason', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F8F7F4]">
                  {bannedUsers.map(u => (
                    <tr key={u.id} className="hover:bg-[#FAFAF8]">
                      <td className="px-4 py-3 font-semibold text-[#141414]">{u.displayName}</td>
                      <td className="px-4 py-3 text-[#73706A]">{u.email}</td>
                      <td className="px-4 py-3 text-[#9E9A91] whitespace-nowrap">
                        {u.bannedAt ? new Date(u.bannedAt).toLocaleDateString('en-NZ') : '—'}
                      </td>
                      <td className="px-4 py-3 text-[#73706A] max-w-[200px] truncate">{u.bannedReason ?? '—'}</td>
                      <td className="px-4 py-3">
                        <ModerationActions reportId={null} hasListing={false} hasTargetUser={true} targetAlreadyBanned={true} unbanUserId={u.id} />
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
