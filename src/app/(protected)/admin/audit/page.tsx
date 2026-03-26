// src/app/(protected)/admin/audit/page.tsx
// ─── Audit Log (Super Admin only) ────────────────────────────────────────────
import Link from 'next/link';
import { requireSuperAdmin } from '@/shared/auth/requirePermission';
import db from '@/lib/db';
import type { Metadata } from 'next';
import AuditExport from './AuditExport';

export const metadata: Metadata = { title: 'Audit Log — KiwiMart Admin' };
export const dynamic = 'force-dynamic';

const ACTION_COLORS: Record<string, string> = {
  ADMIN_ACTION: 'bg-violet-50 text-violet-700',
  USER_REGISTER: 'bg-emerald-50 text-emerald-700',
  USER_LOGIN: 'bg-sky-50 text-sky-700',
  DISPUTE_RESOLVED: 'bg-red-50 text-red-700',
  PAYMENT_COMPLETED: 'bg-emerald-50 text-emerald-700',
  PAYMENT_FAILED: 'bg-red-50 text-red-700',
};

export default async function AuditPage() {
  await requireSuperAdmin();

  const auditLogs = await db.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      user: { select: { displayName: true, email: true, adminRole: true } },
    },
  });

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      <div className="bg-[#141414] text-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <Link href="/admin" className="hover:text-white">Admin</Link>
            <span>/</span>
            <span className="text-white">Audit Log</span>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">📋</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">Audit Log</h1>
          </div>
          <p className="text-white/50 text-[13.5px]">Immutable system activity log — last 100 entries</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="bg-white rounded-2xl border border-[#E3E0D9]">
          <div className="flex items-center justify-between p-5 border-b border-[#F0EDE8]">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
              Activity Log
            </h2>
            <AuditExport entries={auditLogs.map(l => ({
              id: l.id,
              createdAt: l.createdAt,
              action: l.action,
              entityType: l.entityType ?? '',
              entityId: l.entityId ?? '',
              userEmail: l.user?.email ?? 'system',
              ip: l.ip ?? '',
            }))} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                  {['Timestamp', 'Actor', 'Role', 'Action', 'Entity Type', 'Entity ID', 'IP'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F8F7F4]">
                {auditLogs.map(log => (
                  <tr key={log.id} className="hover:bg-[#FAFAF8]">
                    <td className="px-4 py-3 text-[#9E9A91] whitespace-nowrap text-[11px]">
                      {new Date(log.createdAt).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#141414]">{log.user?.displayName ?? 'System'}</p>
                      <p className="text-[#9E9A91] text-[11px]">{log.user?.email ?? ''}</p>
                    </td>
                    <td className="px-4 py-3 text-[#9E9A91] text-[11px]">{log.user?.adminRole ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ACTION_COLORS[log.action] ?? 'bg-[#F8F7F4] text-[#73706A]'}`}>
                        {log.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#73706A]">{log.entityType ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-[#9E9A91] max-w-[100px] truncate">{log.entityId ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-[#9E9A91]">{log.ip ?? '—'}</td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-[#9E9A91]">No audit logs yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
