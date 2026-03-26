// src/app/(protected)/admin/layout.tsx
// ─── Admin Shell with Role Sidebar ────────────────────────────────────────────

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import AdminNav from '@/components/admin/AdminNav';
import { getRoleDisplayName, getRoleBadgeColor } from '@/lib/permissions';
import type { AdminRole } from '@prisma/client';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login?from=/admin');
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      isAdmin: true,
      adminRole: true,
      displayName: true,
      email: true,
    },
  });

  if (!user?.isAdmin || !user.adminRole) {
    redirect('/dashboard/buyer');
  }

  const role = user.adminRole as AdminRole;

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[#141414] min-h-screen flex-shrink-0 flex flex-col fixed top-0 left-0 h-full z-30">
        {/* Logo */}
        <div className="p-6 border-b border-white/10">
          <p className="text-white font-semibold text-[15px]">🥝 KiwiMart</p>
          <p className="text-[#73706A] text-[11px] mt-0.5">Admin Panel</p>
        </div>

        {/* Role badge */}
        <div className="px-4 py-3 border-b border-white/10">
          <p className="text-white/60 text-[11px] mb-1">Signed in as</p>
          <p className="text-white text-[13px] font-medium truncate">{user.displayName}</p>
          <span
            className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
            style={{ background: getRoleBadgeColor(role) }}
          >
            {getRoleDisplayName(role)}
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <AdminNav userRole={role} />
        </nav>

        {/* Back to site */}
        <div className="p-4 border-t border-white/10">
          <a
            href="/"
            className="text-white/40 hover:text-white/70 text-[12px] transition-colors"
          >
            ← Back to marketplace
          </a>
        </div>
      </aside>

      {/* Main content — offset by sidebar width */}
      <main className="flex-1 overflow-auto ml-64">
        {children}
      </main>
    </div>
  );
}
