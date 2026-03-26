'use client';
// src/components/admin/AdminNav.tsx
// ─── Role-filtered admin sidebar navigation ───────────────────────────────────

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { hasPermission, type Permission } from '@/lib/permissions';
import type { AdminRole } from '@prisma/client';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission: Permission | null;
}

const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/admin',            label: 'Overview',    icon: '📊', permission: null },
  { href: '/admin/finance',    label: 'Finance',     icon: '💰', permission: 'VIEW_REVENUE' },
  { href: '/admin/disputes',   label: 'Disputes',    icon: '⚖️', permission: 'VIEW_DISPUTES' },
  { href: '/admin/moderation', label: 'Moderation',  icon: '🛡️', permission: 'VIEW_REPORTS' },
  { href: '/admin/sellers',    label: 'Sellers',     icon: '🏪', permission: 'VIEW_SELLERS' },
  { href: '/admin/support',    label: 'Support',     icon: '💬', permission: 'VIEW_ORDER_DETAILS' },
  { href: '/admin/users',      label: 'Users',       icon: '👥', permission: 'VIEW_USERS' },
  { href: '/admin/audit',      label: 'Audit Log',   icon: '📋', permission: 'VIEW_AUDIT_LOGS' },
  { href: '/admin/system',     label: 'System',      icon: '⚙️', permission: 'VIEW_SYSTEM_HEALTH' },
  { href: '/admin/team',       label: 'Team',        icon: '👤', permission: 'MANAGE_ADMIN_ROLES' },
];

interface Props {
  userRole: AdminRole;
}

export default function AdminNav({ userRole }: Props) {
  const pathname = usePathname();

  const visibleItems = ALL_NAV_ITEMS.filter(
    item => item.permission === null || hasPermission(userRole, item.permission)
  );

  return (
    <ul className="space-y-0.5 px-3">
      {visibleItems.map(({ href, label, icon }) => {
        // Exact match for /admin, prefix match for sub-pages
        const isActive =
          href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

        return (
          <li key={href}>
            <Link
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
