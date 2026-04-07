"use client";
// src/app/(protected)/dashboard/buyer/_components/DashboardHeader.tsx

import Link from "next/link";
import { Avatar, Button } from "@/components/ui/primitives";
import ProfileCompletion from "@/components/onboarding/ProfileCompletion";
import type {
  DashboardUser,
  BuyerOrderRow,
  WatchlistRow,
} from "@/server/actions/dashboard";

export function WelcomeBanner({
  user,
  orders,
  watchlist,
  welcomeDismissed,
  onDismiss,
}: {
  user: DashboardUser;
  orders: BuyerOrderRow[];
  watchlist: WatchlistRow[];
  welcomeDismissed: boolean;
  onDismiss: () => void;
}) {
  if (
    welcomeDismissed ||
    orders.length !== 0 ||
    watchlist.length !== 0 ||
    new Date(user.createdAt) <= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  ) {
    return null;
  }
  return (
    <div className="bg-[#FFF9EC] border border-[#D4A843]/30 rounded-2xl p-5 mb-6 flex items-start justify-between gap-4">
      <div className="flex-1">
        <h2 className="font-semibold text-[#141414] text-[16px] mb-1">
          Welcome to {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"},{" "}
          {user.displayName}! 🥝
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
        onClick={onDismiss}
        className="text-[#C9C5BC] hover:text-[#73706A] transition-colors text-lg flex-shrink-0 leading-none mt-0.5"
        aria-label="Dismiss welcome banner"
      >
        ✕
      </button>
    </div>
  );
}

export function ProfileHeader({
  user,
  orders,
  watchlist,
}: {
  user: DashboardUser;
  orders: BuyerOrderRow[];
  watchlist: WatchlistRow[];
}) {
  return (
    <>
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
                value: orders.filter((o) => o.status === "completed").length,
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
    </>
  );
}

export function SellerSetupPrompt({ user }: { user: DashboardUser }) {
  if (
    !(user.onboardingIntent === "SELL" || user.onboardingIntent === "BOTH") ||
    user.isStripeOnboarded
  ) {
    return null;
  }
  return (
    <div className="bg-[#FFF9EC] border border-[#D4A843]/40 rounded-2xl p-5 mb-6 flex items-start justify-between gap-4">
      <div className="flex-1">
        <h3 className="font-semibold text-[#141414] text-[15px] mb-1">
          📦 Finish setting up your seller account
        </h3>
        <p className="text-[#73706A] text-[13px] mb-3">
          Connect your bank account to start receiving payments when your items
          sell.
        </p>
        <Link
          href="/dashboard/seller/onboarding"
          className="inline-flex items-center gap-1.5 bg-[#D4A843] text-[#141414] px-4 py-2 rounded-xl text-[13px] font-semibold hover:bg-[#B8912E] hover:text-white transition-colors"
        >
          Complete seller setup →
        </Link>
      </div>
    </div>
  );
}
