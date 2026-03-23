'use client';
// src/app/(public)/listings/[id]/ShippingEstimate.tsx
// ─── Shipping Estimate Panel ────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { formatPrice } from '@/lib/utils';
import { calculateShipping } from '@/server/actions/shipping';

interface Props {
  sellerRegion: string;
}

export default function ShippingEstimate({ sellerRegion }: Props) {
  const { data: session } = useSession();
  const [rate, setRate] = useState<number | null>(null);
  const [estimatedDays, setEstimatedDays] = useState<string | null>(null);
  const [isRural, setIsRural] = useState(false);
  const [loading, setLoading] = useState(false);
  const [buyerRegion, setBuyerRegion] = useState<string | null>(null);

  // Auto-calculate if user is logged in and has a region
  useEffect(() => {
    if (!session?.user) return;

    // Try to get the user's region from the session or default to Auckland
    async function loadEstimate() {
      setLoading(true);
      // Default to Auckland if no region stored — user can change via dropdown
      const region = buyerRegion || 'Auckland';
      const result = await calculateShipping({
        fromRegion: sellerRegion,
        toRegion: region,
      });
      if (result.success) {
        setRate(result.data.rateCents);
        setEstimatedDays(result.data.estimatedDays);
        setIsRural(result.data.isRural);
      }
      setLoading(false);
    }
    loadEstimate();
  }, [session, sellerRegion, buyerRegion]);

  async function handleRegionChange(region: string) {
    setBuyerRegion(region);
    setLoading(true);
    const result = await calculateShipping({
      fromRegion: sellerRegion,
      toRegion: region,
    });
    if (result.success) {
      setRate(result.data.rateCents);
      setEstimatedDays(result.data.estimatedDays);
      setIsRural(result.data.isRural);
    }
    setLoading(false);
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-4">
      <div className="flex items-center gap-2 mb-3">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#73706A" strokeWidth="1.8">
          <rect x="1" y="3" width="15" height="13" />
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
        <h3 className="text-[12.5px] font-semibold text-[#141414]">Shipping estimate</h3>
      </div>

      {!session?.user ? (
        <p className="text-[12px] text-[#9E9A91]">
          <Link href="/login" className="text-[#D4A843] hover:text-[#B8912E] transition-colors font-medium">
            Sign in
          </Link>{' '}
          to see shipping estimate
        </p>
      ) : (
        <div className="space-y-2.5">
          <select
            value={buyerRegion || 'Auckland'}
            onChange={(e) => handleRegionChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#E3E0D9] bg-[#F8F7F4]
              text-[12px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25
              focus:border-[#D4A843] transition"
          >
            {[
              'Auckland', 'Wellington', 'Canterbury', 'Waikato', 'Bay of Plenty',
              'Otago', "Hawke's Bay", 'Manawatū-Whanganui', 'Northland', 'Tasman',
              'Nelson', 'Marlborough', 'Southland', 'Taranaki', 'Gisborne', 'West Coast',
            ].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          {loading ? (
            <div className="animate-pulse h-8 bg-[#F8F7F4] rounded-lg" />
          ) : rate !== null ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[#73706A]">Estimated rate</span>
                <span className="text-[13px] font-semibold text-[#141414]">
                  {formatPrice(rate / 100)}
                </span>
              </div>
              {estimatedDays && (
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#73706A]">Estimated delivery</span>
                  <span className="text-[12px] text-[#141414]">{estimatedDays}</span>
                </div>
              )}
              {isRural && (
                <p className="text-[11px] text-amber-600">
                  Includes $4.00 rural delivery surcharge
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
