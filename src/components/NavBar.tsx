'use client';
// src/components/NavBar.tsx  (Sprint 3 update)
// ─── Navigation Bar ───────────────────────────────────────────────────────────
// Sprint 3: wired to Auth.js useSession() — real session replaces mock.

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import CATEGORIES from '@/data/categories';

const HIDDEN_CATEGORY_IDS = ['vehicles', 'property'];

// ─────────────────────────────────────────────────────────────────────────────
export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [showSellBanner, setShowSellBanner] = useState(false);

  // ── Sign out ───────────────────────────────────────────────────────────────
  // Auth.js v5 (beta.30): use redirectTo (callbackUrl is deprecated).
  // redirect:true is the default so it is omitted.
  const PROTECTED_PREFIXES = [
    '/dashboard',
    '/admin',
    '/sell',
    '/account',
    '/welcome',
    '/seller',
    '/notifications',
    '/checkout',
    '/orders',
    '/reviews',
    '/messages',
  ];
  async function handleSignOut() {
    setMobileOpen(false);
    setAccountOpen(false);
    const isProtected = PROTECTED_PREFIXES.some((p) =>
      window.location.pathname.startsWith(p)
    );
    const redirectTo = isProtected ? '/' : window.location.pathname;
    await signOut({ redirectTo });
  }

  // ── Real notifications ─────────────────────────────────────────────────────
  interface NotifItem {
    id: string;
    type: string;
    title: string;
    body: string;
    read: boolean;
    link: string | null;
    createdAt: string;
  }
  const [notifications, setNotifications] = useState<NotifItem[]>([]);

  function getNotifIcon(type: string): string {
    const icons: Record<string, string> = {
      ORDER_PLACED:     '🛍️',
      ORDER_DISPATCHED: '📦',
      ORDER_COMPLETED:  '✅',
      ORDER_DISPUTED:   '⚠️',
      MESSAGE_RECEIVED: '💬',
      OFFER_RECEIVED:   '💰',
      OFFER_ACCEPTED:   '🎉',
      OFFER_DECLINED:   '❌',
      PRICE_DROP:       '📉',
      WATCHLIST_SOLD:   '🔔',
      ID_VERIFIED:      '✅',
      SYSTEM:           'ℹ️',
    };
    return icons[type] ?? '🔔';
  }

  function formatRelativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days  = Math.floor(diff / 86_400_000);
    if (mins  <  1) return 'Just now';
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days  <  7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-NZ');
  }

  const hasUnread = notifications.some((n) => !n.read);
  const accountRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Normalise session.user into local shape
  const user = session?.user
    ? {
        displayName: session.user.name ?? session.user.email ?? 'Account',
        email: session.user.email ?? '',
        sellerEnabled: (session.user as { sellerEnabled?: boolean }).sellerEnabled ?? false,
        avatarUrl: session.user.image ?? null,
        isAdmin: (session.user as { isAdmin?: boolean }).isAdmin ?? false,
      }
    : null;

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close mobile on route change
  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  // Fetch real notifications when user is logged in
  useEffect(() => {
    if (!user) return;
    fetch('/api/notifications')
      .then((r) => r.json())
      .then((data) => setNotifications(data.notifications ?? []))
      .catch(() => {});
  }, [user]);

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch('/api/notifications', { method: 'PATCH' }).catch(() => {});
  }

  // Show sell banner for logged-in users who haven't set up selling
  useEffect(() => {
    if (user && !user.sellerEnabled) {
      const dismissed = sessionStorage.getItem('sell-banner-dismissed');
      if (!dismissed) setShowSellBanner(true);
    } else {
      setShowSellBanner(false);
    }
  }, [user]);

  const initials = user?.displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      {/* ── Compliance bar ─────────────────────────────────────────────── */}
      <div className="bg-[#141414] text-[11px] text-white/50 text-center py-1.5 px-4">
        🥝 New Zealand&apos;s most trusted marketplace · $0 listing fees ·{' '}
        <Link href="/trust" className="underline hover:text-white transition-colors">
          $3,000 buyer protection
        </Link>
      </div>

      {/* ── Main nav ───────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-[300] bg-white/95 backdrop-blur-md
          border-b border-[#E3E0D9] shadow-sm"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center h-14 gap-4">

            {/* Logo */}
            <Link
              href="/"
              className="flex items-center gap-2 shrink-0 group"
              aria-label="KiwiMart home"
            >
              <div
                className="w-7 h-7 rounded-full bg-[#141414] flex items-center
                  justify-center text-[#D4A843] text-xs font-bold
                  group-hover:bg-[#D4A843] group-hover:text-[#141414]
                  transition-colors duration-200"
              >
                K
              </div>
              <span
                className="font-[family-name:var(--font-playfair)] text-[1.15rem]
                  text-[#141414] tracking-tight hidden sm:block"
              >
                Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
              </span>
            </Link>

            {/* Search bar — desktop */}
            <form
              action="/search"
              method="get"
              className="flex-1 hidden md:flex items-center gap-2 max-w-xl"
              role="search"
            >
              <div className="relative flex-1">
                <input
                  name="q"
                  type="search"
                  placeholder="Search listings…"
                  aria-label="Search listings"
                  className="w-full h-9 pl-9 pr-4 rounded-xl border border-[#C9C5BC]
                    bg-[#F8F7F4] text-[#141414] text-[13px] placeholder:text-[#C9C5BC]
                    focus:outline-none focus:border-[#D4A843] focus:bg-white
                    focus:ring-2 focus:ring-[#D4A843]/20 transition"
                />
                <svg
                  aria-hidden
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9E9A91]"
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </div>
              <button
                type="submit"
                className="h-9 px-4 rounded-xl bg-[#D4A843] text-[#141414]
                  font-semibold text-[12.5px] hover:bg-[#B8912E] hover:text-white
                  transition-colors duration-150 whitespace-nowrap shrink-0"
              >
                Search
              </button>
            </form>

            {/* Right side */}
            <div className={`flex items-center gap-1.5 ml-auto ${mobileOpen ? 'invisible' : ''}`}>
              {/* Sell CTA */}
              <Link
                href="/sell"
                className="hidden sm:flex items-center gap-1.5 h-8 px-3.5 rounded-xl
                  bg-[#141414] text-white text-[12px] font-semibold
                  hover:bg-[#D4A843] hover:text-[#141414] transition-colors
                  duration-150 whitespace-nowrap"
              >
                <svg
                  width="11" height="11" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="3"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Sell
              </Link>

              {user ? (
                <>
                  {/* Notifications */}
                  <div ref={notifRef} className="relative">
                    <button
                      onClick={() => {
                        const opening = !notifOpen;
                        setNotifOpen(opening);
                        setAccountOpen(false);
                        if (opening) {
                          // Refresh list and mark all read when dropdown opens
                          fetch('/api/notifications')
                            .then((r) => r.json())
                            .then((data) => setNotifications(data.notifications ?? []))
                            .catch(() => {});
                          markAllRead();
                        }
                      }}
                      aria-label="Notifications"
                      aria-expanded={notifOpen}
                      className="relative w-9 h-9 rounded-xl flex items-center justify-center
                        text-[#73706A] hover:text-[#141414] hover:bg-[#F8F7F4]
                        transition-colors"
                    >
                      <svg
                        width="17" height="17" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.8"
                      >
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                      {/* Unread dot — shows when there are unread notifications */}
                      {hasUnread && (
                        <span
                          className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full
                            bg-[#D4A843] ring-2 ring-white"
                          aria-label="Unread notifications"
                        />
                      )}
                    </button>

                    {notifOpen && (
                      <div
                        className="absolute top-full right-0 mt-2 w-72 bg-white
                          border border-[#E3E0D9] rounded-2xl shadow-xl overflow-hidden
                          z-[300]"
                      >
                        <div
                          className="flex items-center justify-between px-4 py-3
                            border-b border-[#F0EDE8]"
                        >
                          <p className="text-[13px] font-semibold text-[#141414]">
                            Notifications
                          </p>
                          <button
                            className="text-[11.5px] text-[#D4A843] font-semibold hover:text-[#B8912E]"
                            onClick={markAllRead}
                          >
                            Mark all read
                          </button>
                        </div>
                        <div className="divide-y divide-[#F8F7F4]">
                          {notifications.length === 0 ? (
                            <div className="px-4 py-8 text-center">
                              <p className="text-[13px] text-[#9E9A91]">No notifications yet</p>
                            </div>
                          ) : notifications.slice(0, 5).map((n) => (
                            <Link
                              key={n.id}
                              href={n.link ?? '/notifications'}
                              onClick={() => setNotifOpen(false)}
                              className={`flex items-start gap-3 px-4 py-3
                                hover:bg-[#F8F7F4] cursor-pointer transition-colors
                                ${!n.read ? 'bg-[#F5ECD4]/40' : ''}`}
                            >
                              <span className="text-lg shrink-0 mt-0.5">{getNotifIcon(n.type)}</span>
                              <div className="flex-1 min-w-0">
                                <p className={`text-[12px] text-[#141414] leading-snug ${!n.read ? 'font-semibold' : ''}`}>
                                  {n.title}
                                </p>
                                <p className="text-[11px] text-[#73706A] mt-0.5 line-clamp-2">
                                  {n.body}
                                </p>
                                <p className="text-[10px] text-[#C9C5BC] mt-1">
                                  {formatRelativeTime(n.createdAt)}
                                </p>
                              </div>
                              {!n.read && (
                                <div className="w-2 h-2 rounded-full bg-[#D4A843] shrink-0 mt-1.5" />
                              )}
                            </Link>
                          ))}
                        </div>
                        <Link
                          href="/notifications"
                          className="block text-center py-3 text-[12px] font-semibold
                            text-[#D4A843] hover:text-[#B8912E] transition-colors
                            border-t border-[#F0EDE8]"
                        >
                          View all notifications
                        </Link>
                      </div>
                    )}
                  </div>

                  {/* Account dropdown */}
                  <div ref={accountRef} className="relative">
                    <button
                      onClick={() => {
                        setAccountOpen((v) => !v);
                        setNotifOpen(false);
                      }}
                      aria-label="Account menu"
                      aria-expanded={accountOpen}
                      className="flex items-center gap-2 h-9 pl-2 pr-3 rounded-xl
                        hover:bg-[#F8F7F4] transition-colors"
                    >
                      <div
                        className="w-7 h-7 rounded-full bg-[#141414] text-white text-[11px]
                          font-bold flex items-center justify-center shrink-0"
                      >
                        {initials}
                      </div>
                      <svg
                        aria-hidden
                        className={`text-[#9E9A91] transition-transform duration-150
                          ${accountOpen ? 'rotate-180' : ''}`}
                        width="11" height="11" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>

                    {accountOpen && (
                      <div
                        className="absolute top-full right-0 mt-2 w-56 bg-white
                          border border-[#E3E0D9] rounded-2xl shadow-xl overflow-hidden
                          z-[300]"
                      >
                        {/* User info */}
                        <div className="px-4 py-3 border-b border-[#F0EDE8]">
                          <p className="text-[13px] font-semibold text-[#141414] truncate">
                            {user.displayName}
                          </p>
                          <p className="text-[11.5px] text-[#9E9A91] truncate">{user.email}</p>
                        </div>

                        {/* Admin Panel link */}
                        {user.isAdmin && (
                          <div className="border-b border-[#F0EDE8]">
                            <Link
                              href="/admin"
                              onClick={() => setAccountOpen(false)}
                              className="flex items-center gap-3 px-4 py-2.5 text-[13px]
                                text-[#D4A843] font-semibold hover:bg-[#F5ECD4]/40 transition-colors"
                            >
                              <span className="text-base">⚡</span>
                              Admin Panel
                            </Link>
                          </div>
                        )}

                        {/* Buyer links */}
                        <div className="py-1">
                          {[
                            { href: '/dashboard/buyer?tab=orders', label: 'My orders & purchases', icon: '📦' },
                            { href: '/dashboard/buyer?tab=watchlist', label: 'Watchlist', icon: '❤️' },
                            { href: '/dashboard/buyer?tab=messages', label: 'Messages', icon: '💬' },
                          ].map(({ href, label, icon }) => (
                            <Link
                              key={href}
                              href={href}
                              onClick={() => setAccountOpen(false)}
                              className="flex items-center gap-3 px-4 py-2.5 text-[13px]
                                text-[#141414] hover:bg-[#F8F7F4] transition-colors"
                            >
                              <span className="text-base">{icon}</span>
                              {label}
                            </Link>
                          ))}
                        </div>

                        {/* Seller section */}
                        {user.sellerEnabled && (
                          <>
                            <div className="border-t border-[#F0EDE8] py-1">
                              <p className="px-4 py-1.5 text-[10.5px] font-semibold text-[#9E9A91] uppercase tracking-wide">
                                Selling
                              </p>
                              {[
                                { href: '/dashboard/seller?tab=overview', label: 'Seller dashboard', icon: '📊' },
                                { href: '/sell', label: 'Create listing', icon: '➕' },
                                { href: '/seller/onboarding', label: 'Seller Hub', icon: '🌿' },
                              ].map(({ href, label, icon }) => (
                                <Link
                                  key={href}
                                  href={href}
                                  onClick={() => setAccountOpen(false)}
                                  className="flex items-center gap-3 px-4 py-2.5 text-[13px]
                                    text-[#141414] hover:bg-[#F8F7F4] transition-colors"
                                >
                                  <span className="text-base">{icon}</span>
                                  {label}
                                </Link>
                              ))}
                            </div>
                          </>
                        )}

                        {/* Account + sign out */}
                        <div className="border-t border-[#F0EDE8] py-1">
                          <Link
                            href="/account/settings"
                            onClick={() => setAccountOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-[13px]
                              text-[#141414] hover:bg-[#F8F7F4] transition-colors"
                          >
                            <span className="text-base">⚙️</span>
                            Account settings
                          </Link>
                          <button
                            onClick={handleSignOut}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px]
                              text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <span className="text-base">🚪</span>
                            Sign out
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : status === 'loading' ? (
                /* Loading skeleton */
                <div className="w-9 h-9 rounded-xl bg-[#F0EDE8] animate-pulse" aria-hidden />
              ) : (
                /* Unauthenticated state */
                <div className="flex items-center gap-1.5">
                  <Link
                    href="/login"
                    className="h-8 px-4 rounded-xl text-[12.5px] font-semibold
                      text-[#141414] hover:bg-[#F8F7F4] transition-colors
                      hidden sm:flex items-center"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/register"
                    className="h-8 px-4 rounded-xl bg-[#D4A843] text-[#141414]
                      text-[12.5px] font-semibold hover:bg-[#B8912E] hover:text-white
                      transition-colors duration-150 flex items-center whitespace-nowrap"
                  >
                    Register free
                  </Link>
                </div>
              )}

              {/* Mobile menu button — always visible */}
              <button
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileOpen}
                style={{ visibility: 'visible' }}
                className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center
                  text-[#73706A] hover:bg-[#F8F7F4] transition-colors"
              >
                {mobileOpen ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Category strip — desktop ──────────────────────────────────── */}
        <div
          className="hidden md:block border-t border-[#F0EDE8] bg-[#FAFAF8]"
        >
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex items-center gap-0 overflow-x-auto scrollbar-none">
              <Link
                href="/search"
                className="flex items-center gap-1.5 px-3 py-2.5 text-[12px]
                  font-semibold text-[#73706A] hover:text-[#141414]
                  border-b-2 border-transparent hover:border-[#D4A843]
                  transition-all duration-150 whitespace-nowrap"
              >
                All
              </Link>
              {CATEGORIES.filter((cat) => !HIDDEN_CATEGORY_IDS.includes(cat.id)).map((cat) => (
                <Link
                  key={cat.id}
                  href={`/search?category=${cat.id}`}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-[12px]
                    font-semibold border-b-2 transition-all duration-150 whitespace-nowrap
                    ${pathname === `/search` ? 'text-[#73706A] hover:text-[#141414] border-transparent hover:border-[#D4A843]'
                    : 'text-[#73706A] hover:text-[#141414] border-transparent hover:border-[#D4A843]'}`}
                >
                  <span aria-hidden>{cat.icon}</span>
                  {cat.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* ── Sell banner (buyers without seller setup) ───────────────────── */}
      {showSellBanner && (
        <div className="bg-[#F5ECD4] border-b border-[#D4A843]/20 px-4 py-2 flex
          items-center justify-between gap-4">
          <p className="text-[12.5px] text-[#8B6914]">
            🛍 Want to sell on KiwiMart?{' '}
            <a
              href="/account/stripe"
              className="font-semibold underline ml-1 hover:text-[#141414] transition-colors"
            >
              Set up payments to start listing items →
            </a>
          </p>
          <button
            onClick={() => {
              sessionStorage.setItem('sell-banner-dismissed', 'true');
              setShowSellBanner(false);
            }}
            aria-label="Dismiss"
            className="text-[#9E9A91] hover:text-[#141414] shrink-0 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Mobile drawer ──────────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 md:hidden ${mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
        aria-modal="true"
        role="dialog"
        aria-hidden={!mobileOpen}
      >
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/50 z-[390] transition-opacity duration-300
            ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileOpen(false)}
        />

        {/* Drawer panel */}
        <div
          className={`absolute top-0 right-0 h-full w-[85%] max-w-sm bg-white z-[400]
            shadow-2xl flex flex-col overflow-y-auto
            transform transition-transform duration-300
            ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}`}
        >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 border-b
                border-[#E3E0D9] shrink-0"
            >
              <span
                className="font-[family-name:var(--font-playfair)] text-[1.1rem]
                  text-[#141414]"
              >
                Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
              </span>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="w-8 h-8 rounded-full bg-[#F8F7F4] flex items-center
                  justify-center text-[#73706A]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Mobile search */}
            <div className="px-5 py-4 border-b border-[#E3E0D9]">
              <form action="/search" method="get" role="search">
                <div className="relative">
                  <input
                    name="q"
                    type="search"
                    placeholder="Search listings…"
                    className="w-full h-10 pl-9 pr-4 rounded-xl border border-[#C9C5BC]
                      bg-[#F8F7F4] text-[13px] text-[#141414] placeholder:text-[#C9C5BC]
                      focus:outline-none focus:border-[#D4A843] transition"
                  />
                  <svg aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9E9A91]"
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                </div>
              </form>
            </div>

            {/* Nav links */}
            <nav className="flex-1 py-3">
              {/* Categories */}
              <p className="px-5 py-2 text-[10.5px] font-semibold text-[#9E9A91] uppercase tracking-wide">
                Categories
              </p>
              {CATEGORIES.filter((cat) => !HIDDEN_CATEGORY_IDS.includes(cat.id)).map((cat) => (
                <Link
                  key={cat.id}
                  href={`/search?category=${cat.id}`}
                  className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#141414]
                    hover:bg-[#F8F7F4] transition-colors"
                >
                  <span className="text-base">{cat.icon}</span>
                  {cat.name}
                </Link>
              ))}

              {/* Account */}
              <div className="border-t border-[#E3E0D9] mt-3 pt-3">
                <p className="px-5 py-2 text-[10.5px] font-semibold text-[#9E9A91] uppercase tracking-wide">
                  Account
                </p>
                {user ? (
                  <>
                    <Link href="/dashboard/buyer" className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors">
                      📦 My orders
                    </Link>
                    <Link href="/dashboard/seller" className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors">
                      📊 Seller dashboard
                    </Link>
                    <Link href="/seller/onboarding" className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors">
                      🌿 Seller Hub
                    </Link>
                    <button onClick={handleSignOut} className="w-full flex items-center gap-3 px-5 py-2.5 text-[13px] text-red-500 hover:bg-red-50 transition-colors">
                      🚪 Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <Link href="/login" className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors">
                      Sign in
                    </Link>
                    <Link href="/register" className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#D4A843] font-semibold hover:bg-[#F8F7F4] transition-colors">
                      Register free
                    </Link>
                  </>
                )}
              </div>
            </nav>

            {/* Sell CTA */}
            <div className="px-5 py-4 border-t border-[#E3E0D9] shrink-0">
              <Link
                href="/sell"
                className="flex items-center justify-center gap-2 w-full h-11
                  rounded-xl bg-[#D4A843] text-[#141414] font-semibold text-[14px]
                  hover:bg-[#B8912E] hover:text-white transition-colors"
              >
                + Sell an item
              </Link>
            </div>
          </div>
      </div>
    </>
  );
}

