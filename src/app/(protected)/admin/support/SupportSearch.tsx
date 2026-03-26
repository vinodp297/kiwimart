'use client';
// src/app/(protected)/admin/support/SupportSearch.tsx

import { useState } from 'react';
import { lookupUser, lookupOrder } from '@/server/actions/support';
import { formatPrice } from '@/lib/utils';

type UserResult = Awaited<ReturnType<typeof lookupUser>>;
type OrderResult = Awaited<ReturnType<typeof lookupOrder>>;

export default function SupportSearch() {
  const [tab, setTab] = useState<'users' | 'orders'>('users');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [userResult, setUserResult] = useState<UserResult>(null);
  const [orderResult, setOrderResult] = useState<OrderResult>(null);
  const [notFound, setNotFound] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setNotFound(false);
    setUserResult(null);
    setOrderResult(null);
    try {
      if (tab === 'users') {
        const result = await lookupUser(query);
        setUserResult(result);
        if (!result) setNotFound(true);
      } else {
        const result = await lookupOrder(query);
        setOrderResult(result);
        if (!result) setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }

  const ORDER_STATUS_COLORS: Record<string, string> = {
    COMPLETED: 'bg-emerald-50 text-emerald-700',
    DISPUTED: 'bg-red-50 text-red-700',
    REFUNDED: 'bg-amber-50 text-amber-700',
    CANCELLED: 'bg-[#F8F7F4] text-[#9E9A91]',
    PAYMENT_HELD: 'bg-sky-50 text-sky-700',
    DISPATCHED: 'bg-sky-50 text-sky-700',
    DELIVERED: 'bg-sky-50 text-sky-700',
    AWAITING_PAYMENT: 'bg-[#F8F7F4] text-[#9E9A91]',
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 bg-white border border-[#E3E0D9] rounded-xl p-1 w-fit">
        {(['users', 'orders'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setQuery(''); setUserResult(null); setOrderResult(null); setNotFound(false); }}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${tab === t ? 'bg-[#141414] text-white' : 'text-[#73706A] hover:text-[#141414]'}`}
          >
            {t === 'users' ? '👤 Users' : '📦 Orders'}
          </button>
        ))}
      </div>

      {/* Search form */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={tab === 'users' ? 'Search by email, username, or display name…' : 'Enter exact order ID…'}
          className="flex-1 h-12 px-4 rounded-xl border border-[#C9C5BC] bg-white text-[13.5px] text-[#141414] focus:outline-none focus:border-[#D4A843] focus:ring-2 focus:ring-[#D4A843]/10"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-5 h-12 rounded-xl bg-[#141414] text-white text-[13px] font-semibold hover:bg-[#2a2a2a] transition-colors disabled:opacity-50"
        >
          {loading ? '…' : 'Search'}
        </button>
      </form>

      {/* Not found */}
      {notFound && (
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-8 text-center">
          <p className="text-[#9E9A91] text-[13.5px]">No results found for &ldquo;{query}&rdquo;</p>
        </div>
      )}

      {/* User result */}
      {userResult && (
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
                {userResult.displayName}
              </h3>
              <p className="text-[13px] text-[#73706A]">@{userResult.username} · {userResult.email}</p>
            </div>
            <div className="flex items-center gap-2">
              {userResult.isBanned && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-600 text-white">BANNED</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Email Verified', value: userResult.emailVerified ? '✓ Yes' : '✗ No' },
              { label: 'Phone Verified', value: userResult.phoneVerified ? '✓ Yes' : '✗ No' },
              { label: 'ID Verified', value: userResult.idVerified ? '✓ Yes' : '✗ No' },
              { label: 'Seller', value: userResult.sellerEnabled ? 'Enabled' : 'Disabled' },
              { label: 'Stripe', value: userResult.stripeOnboarded ? 'Connected' : 'Not set up' },
              { label: 'Region', value: userResult.region ?? '—' },
              { label: 'Listings', value: userResult._count.listings.toString() },
              { label: 'Purchases', value: userResult._count.buyerOrders.toString() },
              { label: 'Sales', value: userResult._count.sellerOrders.toString() },
            ].map(({ label, value }) => (
              <div key={label} className="bg-[#F8F7F4] rounded-xl p-3">
                <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-0.5">{label}</p>
                <p className="text-[13px] font-semibold text-[#141414]">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#C9C5BC]">
            Member since {new Date(userResult.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      )}

      {/* Order result */}
      {orderResult && (
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
                {orderResult.listing.title}
              </h3>
              <p className="text-[12px] font-mono text-[#9E9A91]">Order #{orderResult.id}</p>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${ORDER_STATUS_COLORS[orderResult.status] ?? 'bg-[#F8F7F4] text-[#9E9A91]'}`}>
              {orderResult.status.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Buyer', value: `${orderResult.buyer.displayName} (${orderResult.buyer.email})` },
              { label: 'Seller', value: `${orderResult.seller.displayName} (${orderResult.seller.email})` },
              { label: 'Total', value: formatPrice(orderResult.totalNzd / 100) },
              { label: 'Item', value: formatPrice(orderResult.itemNzd / 100) },
              { label: 'Shipping', value: orderResult.shippingNzd > 0 ? formatPrice(orderResult.shippingNzd / 100) : 'Free' },
              { label: 'Created', value: new Date(orderResult.createdAt).toLocaleDateString('en-NZ') },
            ].map(({ label, value }) => (
              <div key={label} className="bg-[#F8F7F4] rounded-xl p-3">
                <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-0.5">{label}</p>
                <p className="text-[13px] font-semibold text-[#141414] truncate">{value}</p>
              </div>
            ))}
          </div>
          {orderResult.trackingNumber && (
            <p className="text-[12px] text-[#73706A]">Tracking: <span className="font-mono">{orderResult.trackingNumber}</span></p>
          )}
          {orderResult.status === 'DISPUTED' && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-[12px] font-semibold text-red-800">This order is in dispute</p>
              <a href="/admin/disputes" className="text-[11.5px] text-red-600 hover:underline">→ Go to Disputes dashboard</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
