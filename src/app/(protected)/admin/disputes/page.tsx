// src/app/(protected)/admin/disputes/page.tsx
// ─── Dispute Resolution Centre ────────────────────────────────────────────────

import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import DisputeActionButtons from './DisputeActionButtons';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { formatPrice } from '@/lib/utils';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dispute Resolution — KiwiMart Admin' };
export const dynamic = 'force-dynamic';

const DISPUTE_REASON_LABELS: Record<string, string> = {
  ITEM_NOT_RECEIVED:    'Item not received',
  ITEM_NOT_AS_DESCRIBED: 'Item not as described',
  ITEM_DAMAGED:         'Item damaged',
  SELLER_UNRESPONSIVE:  'Seller unresponsive',
  OTHER:                'Other',
};

function r2Url(key: string | null | undefined): string | null {
  if (!key) return null;
  return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${key}`;
}

function daysOpen(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export default async function DisputesPage() {
  const session = await auth();
  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
  if (!isAdmin) redirect('/dashboard/buyer');

  const disputes = await db.order.findMany({
    where: { status: 'DISPUTED' },
    select: {
      id: true,
      totalNzd: true,
      disputeReason: true,
      disputeNotes: true,
      disputeOpenedAt: true,
      updatedAt: true,
      listing: {
        select: {
          id: true,
          title: true,
          images: { where: { order: 0 }, select: { r2Key: true }, take: 1 },
        },
      },
      buyer: { select: { id: true, email: true, displayName: true } },
      seller: { select: { id: true, email: true, displayName: true } },
    },
    orderBy: { updatedAt: 'asc' },
  });

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        {/* Header band */}
        <div className="bg-[#141414] text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
            <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
              <Link href="/admin" className="hover:text-white transition-colors">Admin</Link>
              <span>/</span>
              <span className="text-white">Disputes</span>
            </div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[#D4A843] text-xl">⚖️</span>
              <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
                Dispute Resolution Centre
              </h1>
            </div>
            <p className="text-white/50 text-[13.5px]">
              {disputes.length === 0
                ? 'No open disputes'
                : `${disputes.length} open dispute${disputes.length === 1 ? '' : 's'} — oldest first`}
            </p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          {disputes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E3E0D9] p-16 text-center">
              <div className="text-5xl mb-4">🎉</div>
              <p className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] mb-1">
                No open disputes
              </p>
              <p className="text-[13.5px] text-[#9E9A91]">All disputes have been resolved.</p>
              <Link
                href="/admin"
                className="inline-block mt-6 px-4 py-2 rounded-xl border border-[#E3E0D9] text-[13px] font-semibold text-[#141414] hover:border-[#D4A843] transition-colors"
              >
                ← Back to Dashboard
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {disputes.map((dispute) => {
                const thumbUrl = r2Url(dispute.listing.images[0]?.r2Key);
                const days = daysOpen(dispute.disputeOpenedAt ?? dispute.updatedAt);
                const reasonLabel = dispute.disputeReason
                  ? (DISPUTE_REASON_LABELS[dispute.disputeReason] ?? dispute.disputeReason)
                  : null;

                return (
                  <div
                    key={dispute.id}
                    className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden"
                  >
                    {/* Card header */}
                    <div className="flex items-center gap-3 px-5 py-3 border-b border-[#F0EDE8] bg-[#FAFAF8]">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
                        🔴 DISPUTED
                      </span>
                      <span className="text-[12px] font-mono text-[#9E9A91]">Order #{dispute.id.slice(0, 12)}…</span>
                      <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold">
                        <span className={`px-2 py-0.5 rounded-full ${
                          days > 7
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {days} day{days === 1 ? '' : 's'} open
                        </span>
                      </span>
                    </div>

                    <div className="p-5 space-y-4">
                      {/* Listing row */}
                      <div className="flex items-center gap-3">
                        {thumbUrl ? (
                          <div className="relative w-14 h-14 rounded-xl overflow-hidden border border-[#E3E0D9] flex-shrink-0">
                            <Image
                              src={thumbUrl}
                              alt={dispute.listing.title}
                              fill
                              className="object-cover"
                              sizes="56px"
                            />
                          </div>
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-[#F8F7F4] border border-[#E3E0D9] flex-shrink-0 flex items-center justify-center text-[#C9C5BC] text-xl">
                            📦
                          </div>
                        )}
                        <div className="min-w-0">
                          <Link
                            href={`/listings/${dispute.listing.id}`}
                            className="font-semibold text-[14px] text-[#141414] hover:text-[#D4A843] transition-colors truncate block"
                          >
                            {dispute.listing.title}
                          </Link>
                          <p className="text-[13px] font-semibold text-[#D4A843]">
                            {formatPrice(dispute.totalNzd / 100)} NZD
                          </p>
                        </div>
                      </div>

                      {/* Buyer / Seller grid */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-[#F8F7F4] rounded-xl p-3 border border-[#E3E0D9]">
                          <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-1.5">Buyer</p>
                          <p className="text-[13px] font-semibold text-[#141414] truncate">{dispute.buyer.displayName}</p>
                          <p className="text-[11.5px] text-[#73706A] truncate">{dispute.buyer.email}</p>
                          <Link
                            href={`/admin/users?search=${encodeURIComponent(dispute.buyer.email)}`}
                            className="text-[10.5px] text-[#D4A843] hover:underline mt-0.5 inline-block"
                          >
                            View profile →
                          </Link>
                        </div>
                        <div className="bg-[#F8F7F4] rounded-xl p-3 border border-[#E3E0D9]">
                          <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-1.5">Seller</p>
                          <p className="text-[13px] font-semibold text-[#141414] truncate">{dispute.seller.displayName}</p>
                          <p className="text-[11.5px] text-[#73706A] truncate">{dispute.seller.email}</p>
                          <Link
                            href={`/admin/users?search=${encodeURIComponent(dispute.seller.email)}`}
                            className="text-[10.5px] text-[#D4A843] hover:underline mt-0.5 inline-block"
                          >
                            View profile →
                          </Link>
                        </div>
                      </div>

                      {/* Dispute details */}
                      {(reasonLabel || dispute.disputeNotes) && (
                        <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-1">
                          {reasonLabel && (
                            <p className="text-[12px] font-semibold text-red-800">
                              Reason: {reasonLabel}
                            </p>
                          )}
                          {dispute.disputeNotes && (
                            <p className="text-[12.5px] text-red-700 italic leading-relaxed">
                              &ldquo;{dispute.disputeNotes}&rdquo;
                            </p>
                          )}
                          {dispute.disputeOpenedAt && (
                            <p className="text-[11px] text-red-500 pt-0.5">
                              Opened {dispute.disputeOpenedAt.toLocaleDateString('en-NZ', {
                                day: 'numeric', month: 'long', year: 'numeric',
                              })}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Action buttons */}
                      <DisputeActionButtons orderId={dispute.id} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
