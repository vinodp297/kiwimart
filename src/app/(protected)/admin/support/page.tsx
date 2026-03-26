// src/app/(protected)/admin/support/page.tsx
// ─── Support Admin Dashboard ──────────────────────────────────────────────────
import Link from 'next/link';
import { requirePermission } from '@/shared/auth/requirePermission';
import type { Metadata } from 'next';
import SupportSearch from './SupportSearch';

export const metadata: Metadata = { title: 'Support — KiwiMart Admin' };
export const dynamic = 'force-dynamic';

export default async function SupportPage() {
  await requirePermission('VIEW_ORDER_DETAILS');

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      <div className="bg-[#141414] text-white">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <Link href="/admin" className="hover:text-white">Admin</Link>
            <span>/</span>
            <span className="text-white">Support</span>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">💬</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">Support Lookup</h1>
          </div>
          <p className="text-white/50 text-[13.5px]">Search users and orders for customer support</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <SupportSearch />
      </div>
    </div>
  );
}
