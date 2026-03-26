'use client';
// src/app/(protected)/admin/disputes/DisputeActionButtons.tsx

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { resolveDispute } from '@/server/actions/admin';

interface Props {
  orderId: string;
}

export default function DisputeActionButtons({ orderId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<'buyer' | 'seller' | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handle(favour: 'buyer' | 'seller') {
    const label = favour === 'buyer' ? 'refund the buyer' : 'release funds to the seller';
    if (!confirm(`Are you sure you want to ${label}? This action cannot be undone and will process the payment.`)) return;
    setLoading(favour);
    setError('');
    const result = await resolveDispute(orderId, favour);
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      setDone(true);
      router.refresh();
    }
  }

  if (done) {
    return (
      <p className="text-[12px] text-green-700 font-semibold">✓ Resolved</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          onClick={() => handle('buyer')}
          disabled={loading !== null}
          className="flex-1 px-3 py-2 rounded-xl text-[12.5px] font-semibold bg-green-600 text-white
            hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === 'buyer' ? '…' : '↩ Refund Buyer'}
        </button>
        <button
          onClick={() => handle('seller')}
          disabled={loading !== null}
          className="flex-1 px-3 py-2 rounded-xl text-[12.5px] font-semibold bg-[#D4A843] text-white
            hover:bg-[#C09535] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === 'seller' ? '…' : 'Release to Seller →'}
        </button>
      </div>
      {error && (
        <p className="text-[11.5px] text-red-600">{error}</p>
      )}
      <p className="text-[11px] text-[#9E9A91]">⚠️ This action is irreversible</p>
    </div>
  );
}
