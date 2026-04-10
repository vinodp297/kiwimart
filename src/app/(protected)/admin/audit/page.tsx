// src/app/(protected)/admin/audit/page.tsx
// ─── Audit Log with Pagination & Filtering (Super Admin only) ──────────────
import Link from "next/link";
import { requireSuperAdmin } from "@/shared/auth/requirePermission";
// eslint-disable-next-line no-restricted-imports -- pre-existing page-level DB access, migrate to repository in a dedicated sprint
import db from "@/lib/db";
import type { Metadata } from "next";
import type { AuditAction, Prisma } from "@prisma/client";
import AuditExport from "./AuditExport";
import AuditLogTable from "./AuditLogTable";

export const metadata: Metadata = { title: "Audit Log — Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AuditPage(props: {
  searchParams: Promise<{
    page?: string;
    action?: string;
    from?: string;
    to?: string;
    user?: string;
  }>;
}) {
  await requireSuperAdmin();

  const searchParams = await props.searchParams;
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const actionFilter = searchParams.action || "";
  const dateFrom = searchParams.from || "";
  const dateTo = searchParams.to || "";
  const userSearch = searchParams.user || "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build WHERE clause
  const where: Prisma.AuditLogWhereInput = {};

  if (actionFilter) {
    where.action = actionFilter as AuditAction;
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

  const [
    auditLogs,
    totalCount,
    actionsToday,
    bannedToday,
    disputesResolvedToday,
    sellersApprovedToday,
    actionTypesRaw,
  ] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: {
          select: { displayName: true, email: true, adminRole: true },
        },
      },
    }),
    db.auditLog.count({ where }),
    db.auditLog.count({ where: { createdAt: { gte: today } } }),
    db.auditLog.count({
      where: { action: "ADMIN_ACTION", createdAt: { gte: today } },
    }),
    db.auditLog.count({
      where: { action: "DISPUTE_RESOLVED", createdAt: { gte: today } },
    }),
    db.auditLog.count({
      where: {
        action: "ADMIN_ACTION",
        entityType: "ID_VERIFICATION",
        createdAt: { gte: today },
      },
    }),
    db.auditLog.groupBy({
      by: ["action"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
  ]);

  const actionTypes = actionTypesRaw.map((a) => ({
    action: a.action,
    count: a._count.id,
  }));
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const kpis = [
    { label: "Actions Today", value: actionsToday },
    { label: "Bans Today", value: bannedToday },
    { label: "Disputes Resolved", value: disputesResolvedToday },
    { label: "Sellers Approved", value: sellersApprovedToday },
  ];

  // Build query string helper for pagination links
  function buildQs(p: number) {
    const params = new URLSearchParams();
    params.set("page", String(p));
    if (actionFilter) params.set("action", actionFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (userSearch) params.set("user", userSearch);
    return `?${params.toString()}`;
  }

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      <div className="bg-[#141414] text-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <Link href="/admin" className="hover:text-white">
              Admin
            </Link>
            <span>/</span>
            <span className="text-white">Audit Log</span>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">📋</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
              Audit Log
            </h1>
          </div>
          <p className="text-white/50 text-[13.5px]">
            Immutable system activity log — {totalCount.toLocaleString()}{" "}
            {totalCount === 1 ? "entry" : "entries"} matching
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Activity KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(({ label, value }) => (
            <div
              key={label}
              className="bg-white rounded-2xl border border-[#E3E0D9] p-5"
            >
              <p className="text-[12px] text-[#9E9A91] font-medium mb-1">
                {label}
              </p>
              <p className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] leading-none">
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <form className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
          <div className="flex flex-wrap items-end gap-3">
            {/* Action filter */}
            <div className="flex-1 min-w-[150px]">
              <label className="block text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide mb-1">
                Action
              </label>
              <select
                name="action"
                defaultValue={actionFilter}
                className="w-full text-[12px] border border-[#E3E0D9] rounded-lg px-3 py-2 bg-white text-[#141414] focus:outline-none focus:ring-1 focus:ring-[#D4A843]"
              >
                <option value="">All actions</option>
                {actionTypes.map((at) => (
                  <option key={at.action} value={at.action}>
                    {at.action.replace(/_/g, " ")} ({at.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Date from */}
            <div className="min-w-[140px]">
              <label className="block text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide mb-1">
                From
              </label>
              <input
                type="date"
                name="from"
                defaultValue={dateFrom}
                className="w-full text-[12px] border border-[#E3E0D9] rounded-lg px-3 py-2 bg-white text-[#141414] focus:outline-none focus:ring-1 focus:ring-[#D4A843]"
              />
            </div>

            {/* Date to */}
            <div className="min-w-[140px]">
              <label className="block text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide mb-1">
                To
              </label>
              <input
                type="date"
                name="to"
                defaultValue={dateTo}
                className="w-full text-[12px] border border-[#E3E0D9] rounded-lg px-3 py-2 bg-white text-[#141414] focus:outline-none focus:ring-1 focus:ring-[#D4A843]"
              />
            </div>

            {/* User search */}
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide mb-1">
                User
              </label>
              <input
                type="text"
                name="user"
                defaultValue={userSearch}
                placeholder="Search by name or email"
                className="w-full text-[12px] border border-[#E3E0D9] rounded-lg px-3 py-2 bg-white text-[#141414] placeholder:text-[#C9C5BC] focus:outline-none focus:ring-1 focus:ring-[#D4A843]"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="px-4 py-2 bg-[#141414] text-white text-[12px] font-semibold rounded-lg hover:bg-[#2a2a2a] transition-colors"
            >
              Filter
            </button>

            {/* Reset */}
            {(actionFilter || dateFrom || dateTo || userSearch) && (
              <Link
                href="/admin/audit"
                className="px-4 py-2 border border-[#E3E0D9] text-[#73706A] text-[12px] font-semibold rounded-lg hover:bg-[#F8F7F4] transition-colors"
              >
                Reset
              </Link>
            )}
          </div>
        </form>

        {/* Export */}
        <div className="flex justify-end">
          <AuditExport
            entries={auditLogs.map((l) => ({
              id: l.id,
              createdAt: l.createdAt,
              action: l.action,
              entityType: l.entityType ?? "",
              entityId: l.entityId ?? "",
              userEmail: l.user?.email ?? "system",
              ip: l.ip ?? "",
            }))}
          />
        </div>

        <AuditLogTable entries={auditLogs} actionTypes={actionTypes} />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between bg-white rounded-2xl border border-[#E3E0D9] px-5 py-3">
            <p className="text-[12px] text-[#9E9A91]">
              Page {page} of {totalPages} · {totalCount.toLocaleString()} total
              entries
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`/admin/audit${buildQs(page - 1)}`}
                  className="px-3 py-1.5 border border-[#E3E0D9] text-[12px] font-semibold text-[#141414] rounded-lg hover:bg-[#F8F7F4] transition-colors"
                >
                  ← Previous
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/admin/audit${buildQs(page + 1)}`}
                  className="px-3 py-1.5 bg-[#141414] text-white text-[12px] font-semibold rounded-lg hover:bg-[#2a2a2a] transition-colors"
                >
                  Next →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
