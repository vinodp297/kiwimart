"use client";
// src/app/(protected)/dashboard/buyer/page.tsx
// ─── Buyer Dashboard ──────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/primitives";
import { fetchBuyerDashboard } from "@/server/actions/dashboard";
import type {
  DashboardUser,
  BuyerOrderRow,
  WatchlistRow,
  ThreadRow,
} from "@/server/actions/dashboard";
import { toggleWatch } from "@/server/actions/listings";

import { EmailVerifyBanner } from "./_components/EmailVerifyBanner";
import { OrderCard } from "./_components/OrderCard";
import { WatchlistCard } from "./_components/WatchlistCard";
import { RecentlyViewedTab } from "./_components/RecentlyViewedTab";
import { MessagesTab } from "./_components/MessagesTab";
import {
  WelcomeBanner,
  ProfileHeader,
  SellerSetupPrompt,
} from "./_components/DashboardHeader";

type Tab = "orders" | "watchlist" | "messages" | "recently-viewed";

// ─────────────────────────────────────────────────────────────────────────────
export default function BuyerDashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get("tab") as Tab) || "orders";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real data state
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [orders, setOrders] = useState<BuyerOrderRow[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistRow[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeThread, setActiveThread] = useState<ThreadRow | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  // Sync tab from URL changes
  useEffect(() => {
    const tab = searchParams.get("tab") as Tab | null;
    if (
      tab &&
      ["orders", "watchlist", "messages", "recently-viewed"].includes(tab)
    ) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      router.replace(`/dashboard/buyer?tab=${tab}`, { scroll: false });
    },
    [router],
  );

  // Fetch real data on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await fetchBuyerDashboard();
        if (cancelled) return;
        if (result.success) {
          setUser(result.data.user);
          setOrders(result.data.orders);
          setWatchlist(result.data.watchlist);
          setThreads(result.data.threads);
          if (result.data.threads.length > 0) {
            setActiveThread(result.data.threads[0] ?? null);
          }
        } else {
          setError(result.error);
        }
      } catch {
        if (!cancelled)
          setError("We couldn't load your dashboard. Please refresh the page.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const removeFromWatchlist = useCallback(async (listingId: string) => {
    // Optimistic removal
    setWatchlist((w) => w.filter((item) => item.id !== listingId));
    try {
      await toggleWatch({ listingId });
    } catch {
      // Silently fail — could re-add item on error
    }
  }, []);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "orders", label: "Orders", count: orders.length },
    { id: "watchlist", label: "Watchlist", count: watchlist.length },
    {
      id: "messages",
      label: "Messages",
      count: threads.reduce((n, t) => n + t.unreadCount, 0) || undefined,
    },
    { id: "recently-viewed", label: "Recently viewed" },
  ];

  if (loading) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
            <div className="animate-pulse space-y-4">
              <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 h-32" />
              <div className="bg-white rounded-2xl border border-[#E3E0D9] p-4 h-12" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="bg-white rounded-2xl border border-[#E3E0D9] h-48"
                  />
                ))}
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (error || !user) {
    const isAuthError = !error || error.toLowerCase().includes("sign in");
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <p className="text-[14px] text-[#9E9A91]">
              {error || "Please sign in to view your dashboard."}
            </p>
            {isAuthError ? (
              <Link
                href="/login?from=/dashboard/buyer"
                className="mt-3 inline-block"
              >
                <Button variant="primary" size="sm">
                  Sign in
                </Button>
              </Link>
            ) : (
              <button
                onClick={() => window.location.reload()}
                className="mt-3 inline-block"
              >
                <Button variant="primary" size="sm">
                  Try again
                </Button>
              </button>
            )}
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <WelcomeBanner
            user={user}
            orders={orders}
            watchlist={watchlist}
            welcomeDismissed={welcomeDismissed}
            onDismiss={() => setWelcomeDismissed(true)}
          />

          {!user.emailVerified && <EmailVerifyBanner />}

          <ProfileHeader user={user} orders={orders} watchlist={watchlist} />

          <SellerSetupPrompt user={user} />

          {/* ── Tab bar ────────────────────────────────────────────────── */}
          <div
            className="flex border-b border-[#E3E0D9] mb-6 bg-white rounded-t-2xl
              overflow-hidden border border-[#E3E0D9]"
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
                      ? "border-[#141414] text-[#141414]"
                      : "border-transparent text-[#9E9A91] hover:text-[#141414]"
                  }`}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px]
                      text-center ${
                        activeTab === tab.id
                          ? "bg-[#141414] text-white"
                          : "bg-[#EFEDE8] text-[#73706A]"
                      }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── ORDERS TAB ─────────────────────────────────────────────── */}
          {activeTab === "orders" && (
            <div role="tabpanel" aria-label="Orders" className="space-y-3">
              {orders.length === 0 ? (
                <div
                  className="bg-white rounded-2xl border border-dashed border-[#C9C5BC]
                  p-12 text-center"
                >
                  <p className="text-[14px] text-[#9E9A91]">No orders yet</p>
                  <Link href="/search" className="mt-3 inline-block">
                    <Button variant="secondary" size="sm">
                      Browse listings
                    </Button>
                  </Link>
                </div>
              ) : (
                orders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))
              )}
            </div>
          )}

          {/* ── WATCHLIST TAB ──────────────────────────────────────────── */}
          {activeTab === "watchlist" && (
            <div role="tabpanel" aria-label="Watchlist">
              {watchlist.length === 0 ? (
                <div
                  className="bg-white rounded-2xl border border-dashed border-[#C9C5BC]
                  p-12 text-center"
                >
                  <p className="text-[14px] text-[#9E9A91]">
                    Your watchlist is empty
                  </p>
                  <Link href="/search" className="mt-3 inline-block">
                    <Button variant="secondary" size="sm">
                      Find items to watch
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {watchlist.map((item) => (
                    <WatchlistCard
                      key={item.id}
                      item={item}
                      onRemove={() => removeFromWatchlist(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── MESSAGES TAB ───────────────────────────────────────────── */}
          {activeTab === "messages" && (
            <MessagesTab
              threads={threads}
              setThreads={setThreads}
              activeThread={activeThread}
              setActiveThread={setActiveThread}
            />
          )}

          {/* ── RECENTLY VIEWED TAB ─────────────────────────────────────── */}
          {activeTab === "recently-viewed" && <RecentlyViewedTab />}
        </div>
      </main>
      <Footer />
    </>
  );
}
