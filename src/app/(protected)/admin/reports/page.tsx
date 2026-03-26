'use client';
// src/app/(protected)/admin/reports/page.tsx  (Sprint 7)

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { resolveReport } from '@/server/actions/admin';

interface AdminReport {
  id: string;
  listingId: string | null;
  targetUserId: string | null;
  reason: string;
  description: string | null;
  status: string;
  createdAt: string;
  reporter: { username: string };
}

export default function AdminReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;

  useEffect(() => {
    if (status === 'authenticated' && !isAdmin) router.replace('/dashboard/buyer');
  }, [status, isAdmin, router]);

  async function fetchReports() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/reports');
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (isAdmin) fetchReports(); }, [isAdmin]);

  async function handleResolve(reportId: string, action: 'dismiss' | 'remove' | 'ban') {
    setActionLoading(reportId + '_' + action);
    setError('');
    const result = await resolveReport(reportId, action);
    if (!result.success) setError(result.error);
    else fetchReports();
    setActionLoading(null);
  }

  if (status === 'loading' || !isAdmin) return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
        <div className="bg-[#141414] text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
              <Link href="/admin" className="hover:text-white">Admin</Link>
              <span>/</span>
              <span className="text-white">Reports</span>
            </div>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold">
              Pending Reports
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
              <div className="p-12 text-center text-[#9E9A91] text-[13px]">Loading reports…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                      {['Reporter', 'Target', 'Reason', 'Description', 'Date', 'Actions'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F8F7F4]">
                    {reports.map((r) => (
                      <tr key={r.id} className="hover:bg-[#FAFAF8] transition-colors">
                        <td className="px-4 py-3 font-medium text-[#141414]">@{r.reporter.username}</td>
                        <td className="px-4 py-3">
                          {r.listingId ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700">
                              listing
                            </span>
                          ) : r.targetUserId ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-50 text-violet-700">
                              user
                            </span>
                          ) : (
                            <span className="text-[#9E9A91]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[#73706A] capitalize">{r.reason.replace('_', ' ')}</td>
                        <td className="px-4 py-3 text-[#73706A] max-w-[200px] truncate">{r.description ?? '—'}</td>
                        <td className="px-4 py-3 text-[#9E9A91] whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => handleResolve(r.id, 'dismiss')}
                              disabled={actionLoading?.startsWith(r.id)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#F8F7F4] text-[#73706A] hover:bg-[#E3E0D9] transition-colors disabled:opacity-50"
                            >
                              Dismiss
                            </button>
                            {r.listingId && (
                              <button
                                onClick={() => handleResolve(r.id, 'remove')}
                                disabled={actionLoading?.startsWith(r.id)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                              >
                                Remove listing
                              </button>
                            )}
                            {r.targetUserId && (
                              <button
                                onClick={() => handleResolve(r.id, 'ban')}
                                disabled={actionLoading?.startsWith(r.id)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                              >
                                Ban user
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {reports.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-[#9E9A91]">
                          No pending reports 🎉
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
