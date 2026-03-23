'use client';
// src/app/(protected)/admin/disputes/page.tsx  (Sprint 7)

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { resolveDispute } from '@/server/actions/admin';
import { formatPrice } from '@/lib/utils';

interface AdminDispute {
  id: string;
  totalNzd: number;
  updatedAt: string;
  listing: { title: string };
  buyer: { username: string; email: string };
  seller: { username: string; email: string };
}

export default function AdminDisputesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;

  useEffect(() => {
    if (status === 'authenticated' && !isAdmin) router.replace('/dashboard/buyer');
  }, [status, isAdmin, router]);

  async function fetchDisputes() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/disputes');
      if (res.ok) {
        const data = await res.json();
        setDisputes(data.disputes);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (isAdmin) fetchDisputes(); }, [isAdmin]);

  async function handleResolve(orderId: string, favour: 'buyer' | 'seller') {
    setActionLoading(orderId + '_' + favour);
    setError('');
    const result = await resolveDispute(orderId, favour);
    if (!result.success) setError(result.error);
    else fetchDisputes();
    setActionLoading(null);
  }

  function daysOpen(dateStr: string) {
    const ms = Date.now() - new Date(dateStr).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  if (status === 'loading' || !isAdmin) return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="bg-[#141414] text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
              <Link href="/admin" className="hover:text-white">Admin</Link>
              <span>/</span>
              <span className="text-white">Disputes</span>
            </div>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold">
              Disputed Orders
            </h1>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
              {error}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-[#9E9A91] text-[13px]">Loading disputes…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                      {['Order ID', 'Listing', 'Buyer', 'Seller', 'Amount', 'Days open', 'Actions'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F8F7F4]">
                    {disputes.map((d) => (
                      <tr key={d.id} className="hover:bg-[#FAFAF8] transition-colors">
                        <td className="px-4 py-3 font-mono text-[11px] text-[#73706A]">{d.id.slice(0, 12)}…</td>
                        <td className="px-4 py-3 font-medium text-[#141414] max-w-[160px] truncate">{d.listing.title}</td>
                        <td className="px-4 py-3 text-[#73706A]">@{d.buyer.username}</td>
                        <td className="px-4 py-3 text-[#73706A]">@{d.seller.username}</td>
                        <td className="px-4 py-3 font-semibold text-[#141414]">{formatPrice(d.totalNzd / 100)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            daysOpen(d.updatedAt) > 7 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                          }`}>
                            {daysOpen(d.updatedAt)}d
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => handleResolve(d.id, 'buyer')}
                              disabled={actionLoading?.startsWith(d.id)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                            >
                              → Buyer (refund)
                            </button>
                            <button
                              onClick={() => handleResolve(d.id, 'seller')}
                              disabled={actionLoading?.startsWith(d.id)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                            >
                              → Seller (release)
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {disputes.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-[#9E9A91]">
                          No disputed orders 🎉
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
