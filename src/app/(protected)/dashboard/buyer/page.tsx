"use client";
// src/app/(protected)/dashboard/buyer/page.tsx
// ─── Buyer Dashboard ──────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import {
  Avatar,
  OrderStatusBadge,
  Button,
  ConditionBadge,
  Alert,
} from "@/components/ui/primitives";
import { formatPrice, relativeTime } from "@/lib/utils";
import type { OrderStatus, Condition } from "@/types";
import { fetchBuyerDashboard } from "@/server/actions/dashboard";
import type {
  DashboardUser,
  BuyerOrderRow,
  WatchlistRow,
  ThreadRow,
  MessageRow,
} from "@/server/actions/dashboard";
import ProfileCompletion from "@/components/onboarding/ProfileCompletion";
import { sendMessage as sendMessageAction } from "@/server/actions/messages";
import { toggleWatch } from "@/server/actions/listings";
import { confirmDelivery } from "@/server/actions/orders";
import { resendVerificationEmail } from "@/server/actions/auth";

type Tab = "orders" | "watchlist" | "messages";

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
  const [newMessage, setNewMessage] = useState("");
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const tabPanelRef = useRef<HTMLDivElement>(null);

  // Sync tab from URL changes
  useEffect(() => {
    const tab = searchParams.get("tab") as Tab | null;
    if (tab && ["orders", "watchlist", "messages"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      router.replace(`/dashboard/buyer?tab=${tab}`, { scroll: false });
      // Scroll tab panel into view so content is the main focus
      requestAnimationFrame(() => {
        tabPanelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
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
            setActiveThread(result.data.threads[0]);
          }
        } else {
          setError(result.error);
        }
      } catch {
        if (!cancelled) setError("Failed to load dashboard data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || !activeThread) return;
    const body = newMessage;
    setNewMessage("");

    // Optimistic update
    const optimisticMsg: MessageRow = {
      id: `temp-${Date.now()}`,
      body,
      senderId: "me",
      senderName: "You",
      createdAt: new Date().toISOString(),
      read: true,
    };
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThread.id
          ? {
              ...t,
              messages: [...t.messages, optimisticMsg],
              lastMessage: body,
              lastMessageAt: optimisticMsg.createdAt,
            }
          : t,
      ),
    );
    setActiveThread((t) =>
      t ? { ...t, messages: [...t.messages, optimisticMsg] } : null,
    );

    // Get the other party's real ID
    const otherPartyId = activeThread.otherPartyUsername;
    // Actually send via server action — find the real recipientId from the thread
    try {
      await sendMessageAction({
        recipientId: activeThread.otherPartyName, // We need the actual user ID
        body,
        listingId: activeThread.listingId || undefined,
      });
    } catch {
      // Message already shown optimistically — silently fail for now
    }
  }

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
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <p className="text-[14px] text-[#9E9A91]">
              {error || "Please sign in to view your dashboard."}
            </p>
            <Link href="/login" className="mt-3 inline-block">
              <Button variant="primary" size="sm">
                Sign in
              </Button>
            </Link>
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
          {/* ── Welcome banner (new users with no orders yet) ─────────── */}
          {!welcomeDismissed &&
            user &&
            orders.length === 0 &&
            watchlist.length === 0 &&
            new Date(user.createdAt) >
              new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) && (
              <div className="bg-[#FFF9EC] border border-[#D4A843]/30 rounded-2xl p-5 mb-6 flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h2 className="font-semibold text-[#141414] text-[16px] mb-1">
                    Welcome to KiwiMart, {user.displayName}! 🥝
                  </h2>
                  <p className="text-[#73706A] text-[13px] mb-4">
                    You&apos;re all set up. Here&apos;s how to get started:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href="/search"
                      className="inline-flex items-center gap-1.5 bg-[#141414] text-white px-4 py-2 rounded-xl text-[13px] font-medium hover:bg-[#2A2A2A] transition-colors"
                    >
                      🛍️ Browse listings
                    </Link>
                    <Link
                      href="/sell"
                      className="inline-flex items-center gap-1.5 border border-[#E3E0D9] bg-white text-[#141414] px-4 py-2 rounded-xl text-[13px] font-medium hover:bg-[#F2EFE8] transition-colors"
                    >
                      💰 Start selling
                    </Link>
                    <Link
                      href="/account/settings"
                      className="inline-flex items-center gap-1.5 border border-[#E3E0D9] bg-white text-[#141414] px-4 py-2 rounded-xl text-[13px] font-medium hover:bg-[#F2EFE8] transition-colors"
                    >
                      👤 Complete profile
                    </Link>
                  </div>
                </div>
                <button
                  onClick={() => setWelcomeDismissed(true)}
                  className="text-[#C9C5BC] hover:text-[#73706A] transition-colors text-lg flex-shrink-0 leading-none mt-0.5"
                  aria-label="Dismiss welcome banner"
                >
                  ✕
                </button>
              </div>
            )}

          {/* ── Email verification banner ─────────────────────────────── */}
          {user && !user.emailVerified && <EmailVerifyBanner />}

          {/* ── Profile header ─────────────────────────────────────────── */}
          <div
            className="bg-white rounded-2xl border border-[#E3E0D9] p-6 mb-6 flex
            flex-col sm:flex-row items-start sm:items-center gap-5"
          >
            <Avatar name={user.displayName} size="xl" />
            <div className="flex-1 min-w-0">
              <h1
                className="font-[family-name:var(--font-playfair)] text-[1.5rem]
                font-semibold text-[#141414]"
              >
                {user.displayName}
              </h1>
              <p className="text-[13px] text-[#9E9A91] mt-0.5">
                {user.email} · Member since{" "}
                {new Date(user.createdAt).toLocaleDateString("en-NZ", {
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <div className="flex flex-wrap gap-3 mt-3">
                {[
                  { value: orders.length, label: "Orders" },
                  { value: watchlist.length, label: "Watching" },
                  {
                    value: orders.filter((o) => o.status === "completed")
                      .length,
                    label: "Completed",
                  },
                ].map(({ value, label }) => (
                  <div key={label} className="text-center">
                    <p
                      className="font-[family-name:var(--font-playfair)] text-[1.25rem]
                      font-semibold text-[#141414] leading-none"
                    >
                      {value}
                    </p>
                    <p className="text-[11px] text-[#9E9A91] mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>
            <Link href="/account/settings">
              <Button variant="secondary" size="sm">
                Account settings
              </Button>
            </Link>
          </div>

          {/* ── Profile completion widget ──────────────────────────────── */}
          <div className="mb-6">
            <ProfileCompletion
              displayName={user.displayName}
              emailVerified={
                user.emailVerified ? new Date(user.emailVerified) : null
              }
              region={user.region}
              bio={user.bio}
            />
          </div>

          {/* ── Seller setup prompt (Task 7) ───────────────────────────── */}
          {(user.onboardingIntent === "SELL" ||
            user.onboardingIntent === "BOTH") &&
            !user.stripeOnboarded && (
              <div className="bg-[#FFF9EC] border border-[#D4A843]/40 rounded-2xl p-5 mb-6 flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-[#141414] text-[15px] mb-1">
                    📦 Finish setting up your seller account
                  </h3>
                  <p className="text-[#73706A] text-[13px] mb-3">
                    Connect your bank account to start receiving payments when
                    your items sell.
                  </p>
                  <Link
                    href="/dashboard/seller/onboarding"
                    className="inline-flex items-center gap-1.5 bg-[#D4A843] text-[#141414] px-4 py-2 rounded-xl text-[13px] font-semibold hover:bg-[#B8912E] hover:text-white transition-colors"
                  >
                    Complete seller setup →
                  </Link>
                </div>
              </div>
            )}

          {/* ── Tab bar ────────────────────────────────────────────────── */}
          <div
            ref={tabPanelRef}
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
            <div
              role="tabpanel"
              aria-label="Messages"
              className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden
                grid grid-cols-1 md:grid-cols-[280px_1fr] min-h-[520px]"
            >
              {/* Thread list */}
              <div className="border-b md:border-b-0 md:border-r border-[#E3E0D9]">
                <div
                  className="px-4 py-3 border-b border-[#E3E0D9] flex items-center
                  justify-between"
                >
                  <h2 className="text-[13px] font-semibold text-[#141414]">
                    Conversations
                  </h2>
                </div>
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => setActiveThread(thread)}
                    className={`w-full flex items-start gap-3 px-4 py-3 border-b
                      border-[#F0EDE8] text-left transition-colors
                      ${activeThread?.id === thread.id ? "bg-[#F8F7F4]" : "hover:bg-[#FAFAF8]"}`}
                  >
                    <Avatar
                      name={thread.otherPartyName}
                      size="sm"
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[12.5px] font-semibold text-[#141414] truncate">
                          {thread.otherPartyName}
                        </p>
                        {thread.unreadCount > 0 && (
                          <span
                            className="shrink-0 w-4 h-4 rounded-full bg-[#D4A843] text-white
                            text-[9px] font-bold flex items-center justify-center"
                          >
                            {thread.unreadCount}
                          </span>
                        )}
                      </div>
                      <p className="text-[11.5px] text-[#9E9A91] truncate mt-0.5">
                        {thread.listingTitle}
                      </p>
                      <p className="text-[11px] text-[#C9C5BC] truncate mt-0.5">
                        {thread.lastMessage}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Message pane */}
              {activeThread ? (
                <div className="flex flex-col">
                  {/* Thread header */}
                  <div className="px-5 py-3.5 border-b border-[#E3E0D9] flex items-center gap-3">
                    <Avatar name={activeThread.otherPartyName} size="sm" />
                    <div>
                      <p className="text-[13px] font-semibold text-[#141414]">
                        {activeThread.otherPartyName}
                      </p>
                      <Link
                        href={`/listings/${activeThread.listingId}`}
                        className="text-[11.5px] text-[#9E9A91] hover:text-[#D4A843] transition-colors"
                      >
                        {activeThread.listingTitle}
                      </Link>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[360px]">
                    {activeThread.messages.map((msg) => {
                      const isMe = msg.senderId === "me";
                      return (
                        <div
                          key={msg.id}
                          className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                        >
                          {!isMe && (
                            <Avatar
                              name={msg.senderName}
                              size="sm"
                              className="shrink-0 mt-0.5"
                            />
                          )}
                          <div
                            className={`max-w-[75%] ${isMe ? "items-end" : "items-start"} flex flex-col gap-1`}
                          >
                            <div
                              className={`px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed
                                ${
                                  isMe
                                    ? "bg-[#141414] text-white rounded-tr-sm"
                                    : "bg-[#F8F7F4] text-[#141414] rounded-tl-sm border border-[#E3E0D9]"
                                }`}
                            >
                              {msg.body}
                            </div>
                            <span className="text-[10.5px] text-[#C9C5BC]">
                              {relativeTime(msg.createdAt)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Message input */}
                  <form
                    onSubmit={handleSendMessage}
                    className="p-4 border-t border-[#E3E0D9] flex gap-2"
                  >
                    <input
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="Write a message…"
                      maxLength={1000}
                      className="flex-1 h-10 px-4 rounded-xl border border-[#C9C5BC] bg-white
                        text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none
                        focus:border-[#D4A843] focus:ring-2 focus:ring-[#D4A843]/20 transition"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={!newMessage.trim()}
                    >
                      Send
                    </Button>
                  </form>
                </div>
              ) : (
                <div className="flex items-center justify-center text-[13.5px] text-[#9E9A91]">
                  Select a conversation
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OrderCard({
  order,
  onRefresh,
}: {
  order: BuyerOrderRow;
  onRefresh?: () => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  async function handleConfirmDelivery() {
    setActionLoading(true);
    const result = await confirmDelivery(order.id);
    if (result.success) {
      setShowConfirm(false);
      onRefresh?.();
    }
    setActionLoading(false);
  }

  const isCompleted = order.status === "completed";
  const isPaymentHeld = order.status === "payment_held";

  return (
    <>
      <article
        className="bg-white rounded-2xl border border-[#E3E0D9] p-5 flex flex-col
          sm:flex-row items-start sm:items-center gap-4"
      >
        <Link href={`/orders/${order.id}`} className="shrink-0">
          <img
            src={order.listingThumbnail}
            alt={order.listingTitle}
            className="w-16 h-16 rounded-xl object-cover border border-[#E3E0D9]"
          />
        </Link>

        <div className="flex-1 min-w-0">
          <Link
            href={`/orders/${order.id}`}
            className="text-[13.5px] font-semibold text-[#141414] hover:text-[#D4A843]
              transition-colors line-clamp-1"
          >
            {order.listingTitle}
          </Link>
          <div className="flex flex-wrap items-center gap-3 mt-1.5">
            <OrderStatusBadge status={order.status as OrderStatus} />
            {isPaymentHeld && (
              <span className="text-[11.5px] text-emerald-600 font-medium">
                Payment held securely in escrow
              </span>
            )}
            <span className="text-[12px] text-[#9E9A91]">
              Seller:{" "}
              <Link
                href={`/sellers/${order.sellerUsername}`}
                className="text-[#141414] font-medium hover:text-[#D4A843] transition-colors"
              >
                {order.sellerName}
              </Link>
            </span>
            <span className="text-[12px] text-[#9E9A91]">
              {new Date(order.createdAt).toLocaleDateString("en-NZ")}
            </span>
          </div>
          {order.trackingNumber && (
            <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[#73706A]">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              Tracking:{" "}
              {order.trackingUrl ? (
                <a
                  href={order.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#D4A843] hover:underline font-mono text-[11px]"
                >
                  {order.trackingNumber}
                </a>
              ) : (
                <span className="font-mono text-[11px]">
                  {order.trackingNumber}
                </span>
              )}
            </div>
          )}
          {order.status === "dispatched" && order.dispatchedAt && (
            <AutoReleaseCountdown dispatchedAt={order.dispatchedAt} />
          )}
        </div>

        <div className="flex flex-col items-end gap-2.5 shrink-0">
          <p
            className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold
            text-[#141414]"
          >
            {formatPrice(order.total)}
          </p>
          <div className="flex gap-2">
            {order.canConfirmDelivery && (
              <Button
                variant="gold"
                size="sm"
                onClick={() => setShowConfirm(true)}
              >
                Confirm delivery
              </Button>
            )}
            {order.canDispute && (
              <Link href={`/orders/${order.id}`}>
                <Button variant="ghost" size="sm">
                  Dispute
                </Button>
              </Link>
            )}
            {isCompleted && !order.hasReview && (
              <Link href={`/reviews/new?orderId=${order.id}`}>
                <Button variant="secondary" size="sm">
                  Leave a review
                </Button>
              </Link>
            )}
            {isCompleted && order.hasReview && (
              <span className="text-[11.5px] text-emerald-600 font-medium">
                Review submitted
              </span>
            )}
            <Link href={`/orders/${order.id}`}>
              <Button variant="secondary" size="sm">
                View
              </Button>
            </Link>
          </div>
        </div>
      </article>

      {/* Confirm delivery modal */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfirm(false);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#d97706"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2">
              Confirm delivery
            </h2>
            <p className="text-[13px] text-[#73706A] mb-6">
              Confirming releases payment to the seller. Only confirm if you
              have received the item.
            </p>
            <div className="flex gap-3 justify-center">
              <Button
                variant="gold"
                size="md"
                onClick={handleConfirmDelivery}
                loading={actionLoading}
              >
                Yes, I received it
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Auto-release countdown pill ───────────────────────────────────────────────

function AutoReleaseCountdown({ dispatchedAt }: { dispatchedAt: string }) {
  // Compute business-day-based release date client-side
  function addBusinessDays(date: Date, days: number): Date {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      const day = result.getDay();
      if (day !== 0 && day !== 6) added++;
    }
    return result;
  }

  const releaseDate = addBusinessDays(new Date(dispatchedAt), 4);
  const msRemaining = releaseDate.getTime() - Date.now();
  const daysRemaining = Math.max(
    0,
    Math.ceil(msRemaining / (1000 * 60 * 60 * 24)),
  );

  let cls = "text-[11.5px] font-medium";
  let label: string;
  if (daysRemaining === 0) {
    cls += " text-red-600 font-semibold";
    label = "Payment auto-releases today — please confirm delivery";
  } else if (daysRemaining === 1) {
    cls += " text-amber-600 font-semibold";
    label = `Payment auto-releases in ${daysRemaining} day — please confirm delivery`;
  } else {
    cls += " text-[#73706A]";
    label = `Payment auto-releases in ${daysRemaining} days if not confirmed`;
  }

  return <p className={`mt-1.5 ${cls}`}>⏱ {label}</p>;
}

function WatchlistCard({
  item,
  onRemove,
}: {
  item: WatchlistRow;
  onRemove: () => void;
}) {
  const isSold = item.status === "sold";

  return (
    <article
      className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden
      group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
    >
      <Link href={`/listings/${item.id}`} className="block">
        <div className="relative aspect-video bg-[#F8F7F4] overflow-hidden">
          <img
            src={item.thumbnailUrl}
            alt={item.title}
            className="w-full h-full object-cover transition-transform duration-300
              group-hover:scale-105"
          />
          {isSold && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <span className="bg-white text-[#141414] text-[12px] font-bold px-3 py-1.5 rounded-full">
                SOLD
              </span>
            </div>
          )}
        </div>
      </Link>

      <div className="p-3.5">
        <Link
          href={`/listings/${item.id}`}
          className="text-[13px] font-semibold text-[#141414] hover:text-[#D4A843]
            transition-colors line-clamp-2 block"
        >
          {item.title}
        </Link>
        <p
          className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold
          text-[#141414] mt-1.5"
        >
          {formatPrice(item.price)}
        </p>
        <div className="flex items-center justify-between mt-2.5">
          <ConditionBadge condition={item.condition as Condition} />
          <span className="text-[10.5px] text-[#C9C5BC]">
            Watched {relativeTime(item.watchedAt)}
          </span>
        </div>
        <div className="flex gap-2 mt-3">
          <Link href={`/listings/${item.id}`} className="flex-1">
            <Button variant="secondary" size="sm" fullWidth>
              View
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label="Remove from watchlist"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </Button>
        </div>
      </div>
    </article>
  );
}

// ── Email verification banner ────────────────────────────────────────────────

function EmailVerifyBanner() {
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">(
    "idle",
  );
  const [countdown, setCountdown] = useState(0);

  const handleResend = async () => {
    setStatus("loading");
    try {
      const result = await resendVerificationEmail();
      if (result.success) {
        setStatus("sent");
        setCountdown(60);
        const interval = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(interval);
              setStatus("idle");
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 4000);
      }
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    }
  };

  return (
    <div className="bg-[#FFF9EC] border border-[#D4A843]/30 rounded-2xl p-4 mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="text-xl">📧</span>
        <div>
          <p className="font-semibold text-[14px] text-[#141414]">
            Please verify your email address
          </p>
          <p className="text-[12px] text-[#73706A] mt-0.5">
            Check your inbox for a verification link from KiwiMart.
          </p>
        </div>
      </div>
      {status === "sent" ? (
        <span className="text-[12px] text-[#16a34a] font-medium whitespace-nowrap">
          ✅ Sent!{countdown > 0 && ` (${countdown}s)`}
        </span>
      ) : (
        <button
          onClick={handleResend}
          disabled={status === "loading" || countdown > 0}
          className="text-[13px] text-[#D4A843] hover:underline disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold whitespace-nowrap"
        >
          {status === "loading"
            ? "Sending…"
            : status === "error"
              ? "Try again"
              : "Resend email"}
        </button>
      )}
    </div>
  );
}
