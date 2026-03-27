'use client';
// src/app/(protected)/dashboard/seller/page.tsx
// ─── Seller Dashboard ─────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import {
  Avatar,
  Button,
  OrderStatusBadge,
  ConditionBadge,
  Alert,
} from '@/components/ui/primitives';
import { formatPrice, relativeTime } from '@/lib/utils';
import type { OrderStatus, Condition } from '@/types';
import { fetchSellerDashboard } from '@/server/actions/dashboard';
import type {
  DashboardUser,
  SellerStatsRow,
  SellerListingRow as SellerListingRowType,
  SellerOrderRow,
  SellerPayoutRow,
} from '@/server/actions/dashboard';
import { markDispatched } from '@/server/actions/orders';
import { replyToReview } from '@/server/actions/reviews';
import { getStripeAccountStatus } from '@/server/actions/stripe';

type Tab = 'overview' | 'listings' | 'orders' | 'payouts' | 'reviews';

// ─────────────────────────────────────────────────────────────────────────────
export default function SellerDashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get('tab') as Tab) || 'overview';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real data state
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [stats, setStats] = useState<SellerStatsRow | null>(null);
  const [listings, setListings] = useState<SellerListingRowType[]>([]);
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [payouts, setPayouts] = useState<SellerPayoutRow[]>([]);

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [stripeOnboarded, setStripeOnboarded] = useState<boolean | null>(null);
  const [reviews, setReviews] = useState<SellerReviewRow[]>([]);

  // Sync tab from URL
  useEffect(() => {
    const tab = searchParams.get('tab') as Tab | null;
    if (tab && ['overview', 'listings', 'orders', 'payouts', 'reviews'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
    router.replace(`/dashboard/seller?tab=${tab}`, { scroll: false });
  }, [router]);

  // Fetch real data on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [result, stripeResult] = await Promise.all([
          fetchSellerDashboard(),
          getStripeAccountStatus(),
        ]);
        if (cancelled) return;
        if (result.success) {
          setUser(result.data.user);
          setStats(result.data.stats);
          setListings(result.data.listings);
          setOrders(result.data.orders);
          setPayouts(result.data.payouts);
        } else {
          setError(result.error);
        }
        if (stripeResult.success) {
          setStripeOnboarded(stripeResult.data.onboarded);
        }
      } catch {
        if (!cancelled) setError('Failed to load seller dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function handleDeleteListing(id: string) {
    setActionLoading(id);
    // Sprint 5: await deleteListing(id) — server action with ownership check
    await new Promise((r) => setTimeout(r, 600));
    setListings((prev) => prev.filter((l) => l.id !== id));
    setDeleteConfirm(null);
    setActionLoading(null);
  }

  // Loading skeleton
  if (loading) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
            <div className="animate-pulse space-y-4">
              <div className="bg-[#141414] rounded-2xl h-48" />
              <div className="bg-white rounded-2xl border border-[#E3E0D9] p-4 h-12" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="bg-white rounded-2xl border border-[#E3E0D9] h-32" />
                ))}
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (error || !user || !stats) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <p className="text-[14px] text-[#9E9A91]">{error || 'Please sign in to view your seller dashboard.'}</p>
            <Link href="/login" className="mt-3 inline-block">
              <Button variant="primary" size="sm">Sign in</Button>
            </Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  // Locked state — seller terms not accepted
  if (!user.sellerTermsAcceptedAt) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3E0D9] rounded-2xl p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-[#F2EFE8] rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🔒</span>
            </div>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] mb-2">
              Accept seller terms first
            </h1>
            <p className="text-[#73706A] text-[14px] leading-relaxed mb-6">
              To access your seller dashboard and start listing items, please read and accept
              KiwiMart&apos;s seller terms and conditions.
            </p>
            <Link
              href="/seller/onboarding"
              className="inline-block w-full bg-[#D4A843] text-[#141414] py-3 rounded-xl font-semibold text-[14px] hover:bg-[#C49B35] transition-colors"
            >
              Go to Seller Hub →
            </Link>
            <p className="text-[11px] text-[#C9C5BC] mt-4">This takes less than 2 minutes.</p>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const pendingOrders = orders.filter(
    (o) => o.status === 'payment_held' || o.status === 'dispatched'
  );

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'listings', label: 'My Listings', badge: listings.length },
    { id: 'orders', label: 'Orders', badge: pendingOrders.length || undefined },
    { id: 'payouts', label: 'Payouts' },
    { id: 'reviews', label: 'Reviews', badge: stats.reviewCount || undefined },
  ];

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

          {/* ── Stripe setup card (shown until onboarded) ──────────────── */}
          {stripeOnboarded === false && (
            <div className="bg-[#141414] text-white rounded-2xl p-6 mb-6 flex
              flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-[family-name:var(--font-playfair)] text-[1.1rem]
                  font-semibold mb-1">
                  ⚡ Complete your seller setup
                </h3>
                <p className="text-white/60 text-[13.5px]">
                  Connect your bank account to receive payments from buyers.
                </p>
              </div>
              <a
                href="/account/stripe"
                className="shrink-0 px-5 py-2.5 bg-[#D4A843] text-[#141414]
                  font-semibold text-[13.5px] rounded-full hover:bg-[#F5C84A]
                  transition-colors whitespace-nowrap"
              >
                Connect Stripe →
              </a>
            </div>
          )}

          {/* ── Seller header ──────────────────────────────────────────── */}
          <div
            className="relative bg-[#141414] rounded-2xl text-white p-6 sm:p-8 mb-6
              overflow-hidden"
          >
            <div
              aria-hidden
              className="absolute -top-16 -right-16 w-64 h-64 rounded-full
                bg-[#D4A843]/15 blur-[60px] pointer-events-none"
            />
            <div className="relative flex flex-col sm:flex-row items-start
              sm:items-center gap-5">
              <Avatar
                name={user.displayName}
                size="xl"
                className="ring-4 ring-[#D4A843]/30"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2.5 mb-0.5">
                  <h1
                    className="font-[family-name:var(--font-playfair)] text-[1.5rem]
                      font-semibold"
                  >
                    {user.displayName}
                  </h1>
                  {user.idVerified && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5
                        bg-[#D4A843]/20 text-[#D4A843] text-[10.5px] font-semibold
                        rounded-full ring-1 ring-[#D4A843]/30"
                    >
                      Verified
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-white/50">
                  @{user.username} · {user.email}
                </p>

                {/* Quick stats */}
                <div className="flex flex-wrap gap-6 mt-4">
                  {[
                    {
                      value: formatPrice(stats.totalRevenue),
                      label: 'Total revenue',
                      highlight: true,
                    },
                    { value: stats.totalSales.toString(), label: 'Sales' },
                    {
                      value: stats.reviewCount > 0 ? `${stats.avgRating.toFixed(1)} ★` : '—',
                      label: stats.reviewCount > 0 ? `${stats.reviewCount} reviews` : 'No reviews yet',
                    },
                    {
                      value: stats.totalSales >= 5 ? `${stats.responseRate}%` : '—',
                      label: stats.totalSales >= 5 ? 'Response rate' : 'New seller',
                    },
                  ].map(({ value, label, highlight }) => (
                    <div key={label}>
                      <p
                        className={`font-[family-name:var(--font-playfair)] text-[1.25rem]
                          font-semibold leading-none
                          ${highlight ? 'text-[#D4A843]' : 'text-white'}`}
                      >
                        {value}
                      </p>
                      <p className="text-[11.5px] text-white/50 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 shrink-0 self-start">
                <Link href="/sell">
                  <Button variant="gold" size="sm">
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="3"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    New listing
                  </Button>
                </Link>
                <Link href={`/sellers/${user.username}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-white/70 hover:text-white hover:bg-white/10"
                  >
                    Public profile
                  </Button>
                </Link>
              </div>
            </div>

            {/* Pending payout highlight */}
            {stats.pendingPayout > 0 && (
              <div
                className="relative mt-5 flex items-center justify-between gap-4
                  bg-[#D4A843]/10 border border-[#D4A843]/25 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className="text-[#D4A843] shrink-0"
                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2"
                  >
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  <p className="text-[13px] text-white/80">
                    You have{' '}
                    <strong className="text-[#D4A843]">
                      {formatPrice(stats.pendingPayout)}
                    </strong>{' '}
                    pending payout
                  </p>
                </div>
                <button
                  onClick={() => handleTabChange('payouts')}
                  className="text-[12px] text-[#D4A843] font-semibold hover:underline shrink-0"
                >
                  View payouts →
                </button>
              </div>
            )}
          </div>

          {/* ── Tab bar ─────────────────────────────────────────────────── */}
          <div
            className="flex border-b-0 mb-6 bg-white rounded-2xl overflow-hidden
              border border-[#E3E0D9]"
            role="tablist"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-5 py-3.5 text-[13px] font-semibold
                  border-b-2 transition-all duration-150 whitespace-nowrap
                  ${
                    activeTab === tab.id
                      ? 'border-[#141414] text-[#141414]'
                      : 'border-transparent text-[#9E9A91] hover:text-[#141414]'
                  }`}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full
                      min-w-[18px] text-center
                      ${
                        activeTab === tab.id
                          ? 'bg-[#141414] text-white'
                          : 'bg-[#EFEDE8] text-[#73706A]'
                      }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ════════════════════════════════════════════════════════════
              OVERVIEW TAB
          ════════════════════════════════════════════════════════════ */}
          {activeTab === 'overview' && (
            <div className="space-y-6" role="tabpanel" aria-label="Overview">
              {/* KPI cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    icon: (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                    ),
                    value: formatPrice(stats.totalRevenue),
                    label: 'Total revenue',
                    sub: 'All time',
                  },
                  {
                    icon: (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
                      </svg>
                    ),
                    value: stats.totalSales.toString(),
                    label: 'Items sold',
                    sub: 'All time',
                  },
                  {
                    icon: (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    ),
                    value: stats.avgRating.toFixed(1),
                    label: 'Avg rating',
                    sub: `${stats.reviewCount} reviews`,
                  },
                  {
                    icon: (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    ),
                    value: stats.activeListings.toString(),
                    label: 'Active listings',
                    sub: `${stats.pendingOrders} orders pending`,
                  },
                ].map(({ icon, value, label, sub }) => (
                  <div
                    key={label}
                    className="bg-white rounded-2xl border border-[#E3E0D9] p-5
                      hover:shadow-sm transition-shadow"
                  >
                    <div
                      className="w-9 h-9 rounded-xl bg-[#F8F7F4] text-[#73706A]
                        flex items-center justify-center mb-3"
                    >
                      {icon}
                    </div>
                    <p
                      className="font-[family-name:var(--font-playfair)] text-[1.5rem]
                        font-semibold text-[#141414] leading-none"
                    >
                      {value}
                    </p>
                    <p className="text-[12.5px] font-medium text-[#141414] mt-1">
                      {label}
                    </p>
                    <p className="text-[11.5px] text-[#9E9A91] mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Tips */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  // Stripe Connect setup card — show only if not onboarded
                  ...(stripeOnboarded === false
                    ? [
                        {
                          title: 'Set up payouts',
                          body: 'Connect your Stripe account to receive payments when buyers purchase your listings.',
                          cta: 'Connect Stripe',
                          href: '/account/stripe',
                          colour: 'border-[#D4A843]/40 bg-[#F5ECD4]/40',
                        },
                      ]
                    : stripeOnboarded === true
                    ? [
                        {
                          title: 'Payouts active',
                          body: 'Your Stripe account is connected and ready to receive payments from buyers.',
                          cta: 'Manage payouts',
                          href: '/account/stripe',
                          colour: 'border-emerald-200 bg-emerald-50/50',
                        },
                      ]
                    : []),
                  {
                    title: 'Complete your verification',
                    body: 'Verified sellers get 3x more views and build buyer trust faster.',
                    cta: 'Verify now',
                    href: '/account/verify',
                    colour: 'border-[#D4A843]/40 bg-[#F5ECD4]/40',
                  },
                  {
                    title: 'Add more photos',
                    body: 'Listings with 5+ photos receive 60% more enquiries on average.',
                    cta: 'Edit listings',
                    href: '#',
                    colour: 'border-sky-200 bg-sky-50/50',
                  },
                ].map(({ title, body, cta, href, colour }) => (
                  <div
                    key={title}
                    className={`rounded-2xl border p-4 ${colour}`}
                  >
                    <p className="text-[13px] font-semibold text-[#141414] mb-1">
                      {title}
                    </p>
                    <p className="text-[12px] text-[#73706A] leading-relaxed mb-3">
                      {body}
                    </p>
                    <Link
                      href={href}
                      className="text-[12px] font-semibold text-[#D4A843]
                        hover:text-[#B8912E] transition-colors"
                    >
                      {cta} →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              LISTINGS TAB
          ════════════════════════════════════════════════════════════ */}
          {activeTab === 'listings' && (
            <div role="tabpanel" aria-label="My Listings" className="space-y-3">
              {/* Header actions */}
              <div className="flex items-center justify-between">
                <p className="text-[13px] text-[#9E9A91]">
                  {listings.length} active listing{listings.length !== 1 ? 's' : ''}
                </p>
                <Link href="/sell">
                  <Button variant="primary" size="sm">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    New listing
                  </Button>
                </Link>
              </div>

              {listings.length === 0 ? (
                <div
                  className="bg-white rounded-2xl border border-dashed border-[#C9C5BC]
                    p-12 text-center"
                >
                  <p className="text-[14px] text-[#9E9A91] mb-3">
                    No active listings
                  </p>
                  <Link href="/sell">
                    <Button variant="gold" size="sm">Create your first listing</Button>
                  </Link>
                </div>
              ) : (
                listings.map((listing) => (
                  <SellerListingRow
                    key={listing.id}
                    listing={listing}
                    deleteConfirm={deleteConfirm}
                    actionLoading={actionLoading}
                    onDeleteRequest={() => setDeleteConfirm(listing.id)}
                    onDeleteCancel={() => setDeleteConfirm(null)}
                    onDeleteConfirm={() => handleDeleteListing(listing.id)}
                  />
                ))
              )}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              ORDERS TAB
          ════════════════════════════════════════════════════════════ */}
          {activeTab === 'orders' && (
            <div role="tabpanel" aria-label="Orders" className="space-y-3">
              {pendingOrders.length > 0 && (
                <Alert variant="warning">
                  You have <strong>{pendingOrders.length}</strong> order
                  {pendingOrders.length > 1 ? 's' : ''} awaiting action.
                  Dispatch promptly to maintain your seller rating.
                </Alert>
              )}

              {orders.length === 0 ? (
                <div className="bg-white rounded-2xl border border-[#E3E0D9] p-12 text-center">
                  <p className="text-[14px] text-[#9E9A91]">No orders yet</p>
                </div>
              ) : (
                orders.map((order) => (
                  <SellerOrderCard key={order.id} order={order} />
                ))
              )}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              PAYOUTS TAB
          ════════════════════════════════════════════════════════════ */}
          {activeTab === 'payouts' && (
            <div role="tabpanel" aria-label="Payouts" className="space-y-4">
              {/* Payout summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  {
                    value: formatPrice(stats.pendingPayout),
                    label: 'Pending payout',
                    colour: 'text-[#D4A843]',
                  },
                  {
                    value: formatPrice(
                      payouts.filter((p) => p.status === 'paid').reduce(
                        (s, p) => s + p.amount,
                        0
                      )
                    ),
                    label: 'Total paid out',
                    colour: 'text-emerald-600',
                  },
                  {
                    value: formatPrice(stats.totalRevenue),
                    label: 'Lifetime earnings',
                    colour: 'text-[#141414]',
                  },
                ].map(({ value, label, colour }) => (
                  <div
                    key={label}
                    className="bg-white rounded-2xl border border-[#E3E0D9] p-5"
                  >
                    <p
                      className={`font-[family-name:var(--font-playfair)] text-[1.75rem]
                        font-semibold leading-none ${colour}`}
                    >
                      {value}
                    </p>
                    <p className="text-[12.5px] text-[#9E9A91] mt-1.5">{label}</p>
                  </div>
                ))}
              </div>

              <Alert variant="info">
                Payouts are released 3 business days after the buyer confirms delivery.
                Funds arrive in your linked NZ bank account via Stripe.
              </Alert>

              {/* Payout rows */}
              <div className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
                <div
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3
                    border-b border-[#F0EDE8] text-[11px] font-semibold text-[#9E9A91]
                    uppercase tracking-wide"
                >
                  <span>Item</span>
                  <span>Amount</span>
                  <span>Status</span>
                  <span>Date</span>
                </div>

                {payouts.map((payout) => (
                  <PayoutRowCard key={payout.id} payout={payout} />
                ))}
              </div>

              <div className="text-center">
                <p className="text-[12px] text-[#9E9A91]">
                  Payouts processed via{' '}
                  <strong className="text-[#141414]">Stripe Connect</strong>. Need help?{' '}
                  <Link
                    href="/support"
                    className="text-[#D4A843] hover:text-[#B8912E] transition-colors"
                  >
                    Contact support
                  </Link>
                </p>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              REVIEWS TAB
          ════════════════════════════════════════════════════════════ */}
          {activeTab === 'reviews' && (
            <div role="tabpanel" aria-label="Reviews" className="space-y-3">
              <ReviewsTabContent sellerId={user.id} />
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SellerListingRow({
  listing,
  deleteConfirm,
  actionLoading,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  listing: SellerListingRowType;
  deleteConfirm: string | null;
  actionLoading: string | null;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  const isConfirming = deleteConfirm === listing.id;
  const isLoading = actionLoading === listing.id;
  const daysLeft = listing.expiresAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(listing.expiresAt).getTime() - Date.now()) / 86_400_000
        )
      )
    : null;

  return (
    <article
      className={`bg-white rounded-2xl border transition-all duration-200
        ${isConfirming ? 'border-red-300 shadow-sm' : 'border-[#E3E0D9]'}`}
    >
      <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* Thumbnail */}
        <Link href={`/listings/${listing.id}`} className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={listing.thumbnailUrl}
            alt={listing.title}
            className="w-16 h-16 rounded-xl object-cover border border-[#E3E0D9]"
          />
        </Link>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <Link
            href={`/listings/${listing.id}`}
            className="text-[13.5px] font-semibold text-[#141414] hover:text-[#D4A843]
              transition-colors line-clamp-1"
          >
            {listing.title}
          </Link>
          <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
            <ConditionBadge condition={listing.condition as Condition} />
            <span className="text-[12px] text-[#9E9A91]">
              {listing.viewCount.toLocaleString('en-NZ')} views
            </span>
            <span className="text-[12px] text-[#9E9A91]">
              {listing.watcherCount} watchers
            </span>
            {listing.offerCount > 0 && (
              <span className="text-[12px] text-amber-600 font-semibold">
                {listing.offerCount} offer{listing.offerCount > 1 ? 's' : ''}
              </span>
            )}
            {daysLeft !== null && (
              <span
                className={`text-[11.5px] ${daysLeft <= 7 ? 'text-red-500' : 'text-[#9E9A91]'}`}
              >
                Expires in {daysLeft}d
              </span>
            )}
          </div>
        </div>

        {/* Price + actions */}
        <div className="flex items-center gap-4 shrink-0">
          <p
            className="font-[family-name:var(--font-playfair)] text-[1.2rem]
              font-semibold text-[#141414]"
          >
            {formatPrice(listing.price)}
          </p>

          {!isConfirming ? (
            <div className="flex gap-2">
              <Link href={`/sell/edit/${listing.id}`}>
                <Button variant="secondary" size="sm">Edit</Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={onDeleteRequest}>
                <svg
                  width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <p className="text-[12px] text-red-600 font-medium">Delete?</p>
              <Button
                variant="danger"
                size="sm"
                loading={isLoading}
                onClick={onDeleteConfirm}
              >
                Yes, delete
              </Button>
              <Button variant="ghost" size="sm" onClick={onDeleteCancel}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Seller Order Card ─────────────────────────────────────────────────────────

function SellerOrderCard({ order }: { order: SellerOrderRow }) {
  const [showDispatch, setShowDispatch] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [dispatching, setDispatching] = useState(false);

  async function handleDispatch() {
    setDispatching(true);
    await markDispatched({
      orderId: order.id,
      trackingNumber: trackingNumber || undefined,
      trackingUrl: trackingUrl || undefined,
    });
    setDispatching(false);
    setShowDispatch(false);
    window.location.reload();
  }

  return (
    <>
      <article
        className="bg-white rounded-2xl border border-[#E3E0D9] p-5
          flex flex-col sm:flex-row items-start sm:items-center gap-4"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={order.listingThumbnail}
          alt={order.listingTitle}
          className="w-14 h-14 rounded-xl object-cover border border-[#E3E0D9] shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold text-[#141414] line-clamp-1">
            {order.listingTitle}
          </p>
          <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
            <OrderStatusBadge status={order.status as OrderStatus} />
            <span className="text-[12px] text-[#9E9A91]">
              Buyer: <strong className="text-[#141414]">{order.buyerName}</strong>
            </span>
            <span className="text-[12px] text-[#9E9A91]">
              {new Date(order.createdAt).toLocaleDateString('en-NZ')}
            </span>
          </div>
          {order.trackingNumber && (
            <p className="text-[11.5px] text-[#73706A] mt-1.5">
              Tracking: <span className="font-mono">{order.trackingNumber}</span>
            </p>
          )}
          {order.status === 'dispatched' && (
            <p className="text-[11.5px] text-amber-600 font-medium mt-1">
              Awaiting buyer confirmation
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2.5 shrink-0">
          <p className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
            {formatPrice(order.total)}
          </p>
          <div className="flex gap-2">
            {order.status === 'payment_held' && (
              <Button variant="gold" size="sm" onClick={() => setShowDispatch(true)}>
                Mark dispatched
              </Button>
            )}
            <Link href={`/orders/${order.id}`}>
              <Button variant="secondary" size="sm">View details</Button>
            </Link>
          </div>
        </div>
      </article>

      {showDispatch && (
        <div
          className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog" aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDispatch(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4">
              Mark as dispatched
            </h2>
            <div className="space-y-4">
              <div>
                <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                  Courier / tracking number
                </label>
                <input
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="e.g. NZP123456789"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                />
              </div>
              <div>
                <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                  Tracking URL <span className="text-[#9E9A91] font-normal">(optional)</span>
                </label>
                <input
                  value={trackingUrl}
                  onChange={(e) => setTrackingUrl(e.target.value)}
                  placeholder="e.g. https://nzpost.co.nz/track/..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                />
              </div>
              <div className="flex gap-3">
                <Button variant="gold" size="md" onClick={handleDispatch} loading={dispatching}>
                  Confirm dispatch
                </Button>
                <Button variant="ghost" size="md" onClick={() => setShowDispatch(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Reviews Tab Content ──────────────────────────────────────────────────────

interface SellerReviewRow {
  id: string;
  buyerName: string;
  rating: number;
  comment: string;
  listingTitle: string;
  createdAt: string;
  sellerReply: string | null;
}

function ReviewsTabContent({ sellerId }: { sellerId: string }) {
  const [reviews, setReviews] = useState<SellerReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);

  useEffect(() => {
    async function loadReviews() {
      try {
        const { fetchSellerReviews } = await import('@/server/actions/sellerReviews');
        const result = await fetchSellerReviews();
        if (result.success) {
          setReviews(result.data);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    loadReviews();
  }, [sellerId]);

  async function handleReply(reviewId: string) {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    const result = await replyToReview({ reviewId, reply: replyText });
    if (result.success) {
      setReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, sellerReply: replyText } : r))
      );
      setReplyId(null);
      setReplyText('');
    }
    setReplyLoading(false);
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-[#E3E0D9] h-32" />
        ))}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-[#C9C5BC] p-12 text-center">
        <p className="text-[14px] text-[#9E9A91]">No reviews yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((review) => (
        <article key={review.id} className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[13px] font-semibold text-[#141414]">{review.buyerName}</p>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <svg
                      key={s}
                      width="12" height="12" viewBox="0 0 24 24"
                      fill={s <= review.rating ? '#D4A843' : 'none'}
                      stroke={s <= review.rating ? '#D4A843' : '#C9C5BC'}
                      strokeWidth="1.5"
                    >
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  ))}
                </div>
              </div>
              <p className="text-[12px] text-[#9E9A91] mb-2">
                {review.listingTitle} · {relativeTime(review.createdAt)}
              </p>
            </div>
          </div>
          <p className="text-[13px] text-[#141414] leading-relaxed">{review.comment}</p>

          {review.sellerReply ? (
            <div className="mt-3 bg-[#F8F7F4] rounded-xl p-3 border-l-2 border-[#D4A843]">
              <p className="text-[11.5px] font-semibold text-[#141414] mb-1">Your reply</p>
              <p className="text-[12.5px] text-[#73706A]">{review.sellerReply}</p>
            </div>
          ) : replyId === review.id ? (
            <div className="mt-3 space-y-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write your reply..."
                rows={3}
                maxLength={500}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
              />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={() => handleReply(review.id)} loading={replyLoading}>
                  Post reply
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setReplyId(null); setReplyText(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setReplyId(review.id)}
              className="mt-3 text-[12px] font-semibold text-[#D4A843] hover:text-[#B8912E] transition-colors"
            >
              Reply to review →
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

function PayoutRowCard({ payout }: { payout: SellerPayoutRow }) {
  const statusStyles: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-200',
    paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    failed: 'bg-red-50 text-red-600 ring-red-200',
  };

  return (
    <div
      className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-4
        border-b border-[#F8F7F4] last:border-b-0 items-center"
    >
      <p className="text-[13px] text-[#141414] line-clamp-1">{payout.listingTitle}</p>
      <p className="text-[13px] font-semibold text-[#141414]">
        {formatPrice(payout.amount)}
      </p>
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px]
          font-semibold ring-1 ${statusStyles[payout.status] ?? statusStyles.pending}`}
      >
        {payout.status.charAt(0).toUpperCase() + payout.status.slice(1)}
      </span>
      <p className="text-[12px] text-[#9E9A91] whitespace-nowrap">
        {payout.paidAt
          ? new Date(payout.paidAt).toLocaleDateString('en-NZ', {
              day: 'numeric',
              month: 'short',
            })
          : payout.estimatedArrival
          ? `Est. ${new Date(payout.estimatedArrival).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}`
          : '\u2014'}
      </p>
    </div>
  );
}
