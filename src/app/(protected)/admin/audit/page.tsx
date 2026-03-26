// src/app/(protected)/admin/audit/page.tsx
// ─── Audit Log (Super Admin only) ────────────────────────────────────────────
import Link from 'next/link';
import { requireSuperAdmin } from '@/shared/auth/requirePermission';
import db from '@/lib/db';
import type { Metadata } from 'next';
import AuditExport from './AuditExport';
import AuditLogTable from './AuditLogTable';

export const metadata: Metadata = { title: 'Audit Log — KiwiMart Admin' };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  await requireSuperAdmin();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    auditLogs,
    actionsToday,
    bannedToday,
    disputesResolvedToday,
    sellersApprovedToday,
    actionTypesRaw,
  ] = await Promise.all([
    db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { displayName: true, email: true, adminRole: true } },
      },
    }),
    db.auditLog.count({ where: { createdAt: { gte: today } } }),
    db.auditLog.count({ where: { action: 'ADMIN_ACTION', createdAt: { gte: today } } }),
    db.auditLog.count({ where: { action: 'DISPUTE_RESOLVED', createdAt: { gte: today } } }),
    db.auditLog.count({ where: { action: 'ADMIN_ACTION', entityType: 'ID_VERIFICATION', createdAt: { gte: today } } }),
    db.auditLog.groupBy({
      by: ['action'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
  ]);

  const actionTypes = actionTypesRaw.map(a => ({ action: a.action, count: a._count.id }));

  const kpis = [
    { label: 'Actions Today', value: actionsToday },
    { label: 'Bans Today', value: bannedToday },
    { label: 'Disputes Resolved', value: disputesResolvedToday },
    { label: 'Sellers Approved', value: sellersApprovedToday },
  ];

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

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Activity KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(({ label, value }) => (
            <div key={label} className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
              <p className="text-[12px] text-[#9E9A91] font-medium mb-1">{label}</p>
              <p className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] leading-none">{value}</p>
            </div>
          ))}
        </div>

        {/* Export + filtered log table */}
        <div className="flex justify-end">
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

        <AuditLogTable entries={auditLogs} actionTypes={actionTypes} />
      </div>
    </div>
  );
}
