"use client";

import Link from "next/link";
import { Avatar, Button } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/utils";
import { getImageUrl, getDefaultAvatar } from "@/lib/image";
import type { DashboardUser, SellerStatsRow } from "@/server/actions/dashboard";

interface Props {
  user: DashboardUser;
  stats: SellerStatsRow;
  imgUploading: boolean;
  onChangePhoto: () => void;
  onViewPayouts: () => void;
}

export default function SellerDashboardHeader({
  user,
  stats,
  imgUploading,
  onChangePhoto,
  onViewPayouts,
}: Props) {
  return (
    <div
      className="relative bg-[#141414] rounded-2xl text-white p-6 sm:p-8 mb-6
        overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute -top-16 -right-16 w-64 h-64 rounded-full
          bg-[#D4A843]/15 blur-[60px] pointer-events-none"
      />
      <div
        className="relative flex flex-col sm:flex-row items-start
        sm:items-center gap-5"
      >
        {/* Hover-to-edit avatar */}
        <div className="relative group shrink-0">
          <Avatar
            name={user.displayName}
            src={
              user.avatarKey
                ? getImageUrl(user.avatarKey)
                : getDefaultAvatar(user.idVerified ? "id_verified" : undefined)
            }
            size="xl"
            className="ring-4 ring-[#D4A843]/30"
          />
          <button
            onClick={onChangePhoto}
            disabled={imgUploading}
            className="absolute inset-0 rounded-full flex items-center justify-center
              bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity
              cursor-pointer disabled:cursor-wait"
            aria-label="Change profile photo"
            title="Change photo"
          >
            {imgUploading ? (
              <svg
                className="animate-spin"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </button>
        </div>

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
                label: "Total revenue",
                highlight: true,
              },
              { value: stats.totalSales.toString(), label: "Sales" },
              {
                value:
                  stats.reviewCount > 0
                    ? `${stats.avgRating.toFixed(1)} ★`
                    : "—",
                label:
                  stats.reviewCount > 0
                    ? `${stats.reviewCount} reviews`
                    : "No reviews yet",
              },
              {
                value: stats.totalSales >= 5 ? `${stats.responseRate}%` : "—",
                label: stats.totalSales >= 5 ? "Response rate" : "New seller",
              },
            ].map(({ value, label, highlight }) => (
              <div key={label}>
                <p
                  className={`font-[family-name:var(--font-playfair)] text-[1.25rem]
                    font-semibold leading-none
                    ${highlight ? "text-[#D4A843]" : "text-white"}`}
                >
                  {value}
                </p>
                <p className="text-[11.5px] text-white/50 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 shrink-0 self-start">
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
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <p className="text-[13px] text-white/80">
              You have{" "}
              <strong className="text-[#D4A843]">
                {formatPrice(stats.pendingPayout)}
              </strong>{" "}
              pending payout
            </p>
          </div>
          <button
            onClick={onViewPayouts}
            className="text-[12px] text-[#D4A843] font-semibold hover:underline shrink-0"
          >
            View payouts →
          </button>
        </div>
      )}
    </div>
  );
}
