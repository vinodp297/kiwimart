"use client";
// src/components/NavBar.tsx
// ─── Navigation Bar (shell) ──────────────────────────────────────────────────
// Fetches from /api/v1/me/nav-summary once and distributes data to children.
// Replaces 3 separate API calls with a single batched request.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useSessionSafe } from "@/hooks/useSessionSafe";
import NavSearchBar from "./nav/NavSearchBar";
import NavCategoryStrip from "./nav/NavCategoryStrip";
import NavCartBadge from "./nav/NavCartBadge";
import NavNotificationPanel, {
  type NotifItem,
} from "./nav/NavNotificationPanel";
import NavUserDropdown, { type NavUser } from "./nav/NavUserDropdown";
import NavMobileDrawer from "./nav/NavMobileDrawer";
import { getImageUrl } from "@/lib/image";
import { clientError } from "@/lib/client-logger";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/admin",
  "/sell",
  "/account",
  "/welcome",
  "/seller",
  "/notifications",
  "/checkout",
  "/orders",
  "/reviews",
  "/messages",
];

export default function NavBar() {
  const pathname = usePathname();
  const { data: session, status } = useSessionSafe();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSellBanner, setShowSellBanner] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const isAuthenticated = status === "authenticated" && !!session?.user;

  const user: NavUser | null = session?.user
    ? {
        displayName: session.user.name ?? session.user.email ?? "Account",
        email: session.user.email ?? "",
        isSellerEnabled: session.user.isSellerEnabled,
        avatarUrl: getImageUrl(session.user.avatarKey ?? null),
        isAdmin: session.user.isAdmin,
      }
    : null;

  const hasUnread = notifications.some((n) => !n.isRead);
  const initials =
    user?.displayName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "";

  const handleSignOut = useCallback(async () => {
    setMobileOpen(false);
    const isProtected = PROTECTED_PREFIXES.some((p) =>
      window.location.pathname.startsWith(p),
    );
    await signOut({ redirectTo: isProtected ? "/" : window.location.pathname });
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // ── Single batched fetch ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) {
      setCartCount(0);
      setNotifications([]);
      return;
    }
    fetch("/api/v1/me/nav-summary")
      .then((r) => r.json())
      .then((res) => {
        const d = res.data;
        if (!d) return;
        setCartCount(d.cartCount ?? 0);
        setNotifications(d.notifications ?? []);
      })
      .catch((err) => {
        clientError("nav.fetchNavSummary.failed", { error: String(err) });
      });
  }, [isAuthenticated]);

  // ── Optimistic mark-all-read with rollback ─────────────────────────────────
  const handleMarkAllRead = useCallback(() => {
    const prev = notifications;
    setNotifications((ns) => ns.map((n) => ({ ...n, isRead: true })));
    fetch("/api/v1/notifications", { method: "PATCH" }).catch((err) => {
      clientError("nav.markAllRead.failed", { error: String(err) });
      setNotifications(prev);
    });
  }, [notifications]);

  useEffect(() => {
    if (user && !user.isSellerEnabled) {
      if (!sessionStorage.getItem("sell-banner-dismissed"))
        setShowSellBanner(true);
    } else {
      setShowSellBanner(false);
    }
  }, [user]);

  return (
    <>
      <div className="bg-[#141414] text-[11px] text-white/50 text-center py-1.5 px-4">
        🥝 New Zealand&apos;s most trusted marketplace · $0 listing fees ·{" "}
        <Link
          href="/trust"
          className="underline hover:text-white transition-colors"
        >
          {process.env.NEXT_PUBLIC_BUYER_PROTECTION_DISPLAY ?? "$3,000"} buyer
          protection
        </Link>
      </div>

      <header className="sticky top-0 z-[300] bg-white/95 backdrop-blur-md border-b border-[#E3E0D9] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center h-14 gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 shrink-0 group"
              aria-label={`${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} home`}
            >
              <div className="w-7 h-7 rounded-full bg-[#141414] flex items-center justify-center text-[#D4A843] text-xs font-bold group-hover:bg-[#D4A843] group-hover:text-[#141414] transition-colors duration-200">
                K
              </div>
              <span className="font-[family-name:var(--font-playfair)] text-[1.15rem] text-[#141414] tracking-tight hidden sm:block">
                Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
              </span>
            </Link>
            <NavSearchBar />
            <div
              className={`flex items-center gap-1.5 ml-auto ${mobileOpen ? "invisible" : ""}`}
            >
              <Link
                href="/sell"
                className="hidden sm:flex items-center gap-1.5 h-8 px-3.5 rounded-xl bg-[#141414] text-white text-[12px] font-semibold hover:bg-[#D4A843] hover:text-[#141414] transition-colors duration-150 whitespace-nowrap"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Sell
              </Link>
              {user ? (
                <>
                  <NavCartBadge cartCount={cartCount} />
                  <NavNotificationPanel
                    notifications={notifications}
                    hasUnread={hasUnread}
                    onMarkAllRead={handleMarkAllRead}
                  />
                  <NavUserDropdown
                    user={user}
                    initials={initials}
                    onSignOut={handleSignOut}
                  />
                </>
              ) : status === "loading" ? (
                <div
                  className="w-9 h-9 rounded-xl bg-[#F0EDE8] animate-pulse"
                  aria-hidden
                />
              ) : (
                <div className="flex items-center gap-1.5">
                  <Link
                    href="/login"
                    className="h-8 px-4 rounded-xl text-[12.5px] font-semibold text-[#141414] hover:bg-[#F8F7F4] transition-colors hidden sm:flex items-center"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/register"
                    className="h-8 px-4 rounded-xl bg-[#D4A843] text-[#141414] text-[12.5px] font-semibold hover:bg-[#B8912E] hover:text-white transition-colors duration-150 flex items-center whitespace-nowrap"
                  >
                    Register free
                  </Link>
                </div>
              )}
              <button
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileOpen}
                style={{ visibility: "visible" }}
                className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center text-[#73706A] hover:bg-[#F8F7F4] transition-colors"
              >
                {mobileOpen ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
        <NavCategoryStrip />
      </header>

      {showSellBanner && (
        <div className="bg-[#F5ECD4] border-b border-[#D4A843]/20 px-4 py-2 flex items-center justify-between gap-4">
          <p className="text-[12.5px] text-[#8B6914]">
            🛍 Want to sell on {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}?{" "}
            <a
              href="/account/stripe"
              className="font-semibold underline ml-1 hover:text-[#141414] transition-colors"
            >
              Set up payments to start listing items →
            </a>
          </p>
          <button
            onClick={() => {
              sessionStorage.setItem("sell-banner-dismissed", "true");
              setShowSellBanner(false);
            }}
            aria-label="Dismiss"
            className="text-[#9E9A91] hover:text-[#141414] shrink-0 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      <NavMobileDrawer
        open={mobileOpen}
        user={user}
        onClose={() => setMobileOpen(false)}
        onSignOut={handleSignOut}
      />
    </>
  );
}
