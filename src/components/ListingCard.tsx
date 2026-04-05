"use client";
// src/components/ListingCard.tsx  (Sprint 2 update)
// ─── Listing Card ─────────────────────────────────────────────────────────────
// Changes from Sprint 1:
//   • sellerUsername field used for /sellers/[username] link
//   • status badge (sold overlay)
//   • shippingOption displayed (free shipping badge)
//   • offersEnabled chip
//   • Graceful fallback for listings without sellerUsername

import { useState, useCallback, memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSessionSafe } from "@/hooks/useSessionSafe";
import type { ListingCard as ListingCardType } from "@/types";
import {
  formatPrice,
  relativeTime,
  formatCondition,
  CONDITION_COLOURS,
} from "@/lib/utils";
import type { Condition } from "@/types";
import { toggleWatch } from "@/server/actions/listings";

interface Props {
  listing: ListingCardType;
  priority?: boolean;
}

// ── Badge helpers ──────────────────────────────────────────────────────────────
function isJustListed(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000;
}

function isPriceDropped(priceDroppedAt: string | null): boolean {
  if (!priceDroppedAt) return false;
  return Date.now() - new Date(priceDroppedAt).getTime() < 72 * 60 * 60 * 1000;
}

function priceDrop(current: number, previous: number | null): number {
  if (!previous || previous <= current) return 0;
  return Math.round(((previous - current) / previous) * 100);
}

export default memo(function ListingCard({ listing, priority = false }: Props) {
  const [watched, setWatched] = useState(false);
  const { status: sessionStatus } = useSessionSafe();
  const router = useRouter();

  const handleToggleWatch = useCallback(async () => {
    if (sessionStatus !== "authenticated") {
      router.push(`/login?from=/listings/${listing.id}`);
      return;
    }
    // Optimistic update
    setWatched((w) => !w);
    const result = await toggleWatch({ listingId: listing.id });
    if (!result.success) {
      // Revert on error
      setWatched((w) => !w);
    }
  }, [sessionStatus, router, listing.id]);

  const isSold = listing.status === "sold";
  const isFree = listing.shippingPrice === 0;
  const sellerHref = listing.sellerUsername
    ? `/sellers/${listing.sellerUsername}`
    : undefined;

  const justListed = !isSold && isJustListed(listing.createdAt);
  const dropped = !isSold && isPriceDropped(listing.priceDroppedAt ?? null);
  const dropPct = dropped
    ? priceDrop(listing.price, listing.previousPrice ?? null)
    : 0;
  const urgent = !isSold && listing.isUrgent;

  return (
    <article
      className="group relative bg-white rounded-2xl border border-[#E3E0D9]
        overflow-hidden hover:shadow-lg hover:-translate-y-0.5
        transition-all duration-200 flex flex-col"
    >
      {/* ── Image ──────────────────────────────────────────────────────── */}
      <Link
        href={`/listings/${listing.id}`}
        className="block relative"
        tabIndex={-1}
      >
        <div className="relative aspect-square bg-[#F8F7F4] overflow-hidden">
          <Image
            src={
              listing.thumbnailUrl ||
              "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=480&h=480&fit=crop"
            }
            alt={listing.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className={`object-cover transition-transform duration-300
              ${isSold ? "opacity-60" : "group-hover:scale-105"}`}
            priority={priority}
            onError={(e) => {
              e.currentTarget.src =
                "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=480&h=480&fit=crop";
            }}
          />

          {/* Sold overlay */}
          {isSold && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="bg-white text-[#141414] text-[11px] font-bold px-2.5 py-1 rounded-full">
                SOLD
              </span>
            </div>
          )}

          {/* Status badges — top-left stack */}
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {listing.watcherCount >= 5 && !isSold && (
              <span className="bg-orange-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full leading-tight">
                Popular
              </span>
            )}
            {urgent && (
              <span className="bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full leading-tight">
                URGENT
              </span>
            )}
            {justListed && !urgent && (
              <span className="bg-[#141414] text-white text-[9px] font-bold px-2 py-0.5 rounded-full leading-tight">
                🆕 JUST LISTED
              </span>
            )}
            {dropped && dropPct > 0 && (
              <span className="bg-emerald-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full leading-tight">
                ↓ {dropPct}% DROP
              </span>
            )}
          </div>

          {/* Free shipping badge */}
          {isFree && !isSold && (
            <div
              className="absolute bottom-2 left-2 bg-emerald-600 text-white
                text-[9.5px] font-bold px-2 py-0.5 rounded-full"
            >
              FREE SHIPPING
            </div>
          )}

          {/* Watchlist button */}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleToggleWatch();
            }}
            aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
            aria-pressed={watched}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90
              backdrop-blur-sm shadow-sm flex items-center justify-center
              opacity-0 group-hover:opacity-100 transition-all duration-150
              hover:scale-110 border border-[#E3E0D9]"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill={watched ? "#ef4444" : "none"}
              stroke={watched ? "#ef4444" : "#73706A"}
              strokeWidth="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>
      </Link>

      {/* ── Card body ──────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 p-3">
        {/* Condition + offers badge row */}
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-full
              text-[9.5px] font-semibold tracking-wide ring-1
              ${CONDITION_COLOURS[String(listing.condition).toLowerCase().replace(/_/g, "-") as Condition] ?? "bg-[#F8F7F4] text-[#73706A] ring-[#C9C5BC]"}`}
          >
            {formatCondition(listing.condition)}
          </span>
          {listing.offersEnabled && !isSold && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full
              text-[9.5px] font-semibold bg-[#F5ECD4] text-[#8B6914] ring-1 ring-[#D4A843]/30"
            >
              Offers
            </span>
          )}
          {listing.isNegotiable && !isSold && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full
              text-[9.5px] font-semibold bg-blue-50 text-blue-700 ring-1 ring-blue-200"
            >
              Negotiable
            </span>
          )}
          {listing.shipsNationwide && !isSold && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full
              text-[9.5px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
            >
              Ships NZ
            </span>
          )}
        </div>

        {/* Title */}
        <Link href={`/listings/${listing.id}`}>
          <h3
            className="text-[12.5px] font-semibold text-[#141414] leading-snug
              line-clamp-2 hover:text-[#D4A843] transition-colors duration-150 mb-1.5"
          >
            {listing.title}
          </h3>
        </Link>

        {/* Price */}
        <p
          className="font-[family-name:var(--font-playfair)] text-[1.05rem]
            font-semibold text-[#141414] leading-none mb-2"
        >
          {formatPrice(listing.price)}
        </p>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Location */}
        <div className="flex items-center gap-1 mb-1.5">
          <svg
            aria-hidden
            className="text-[#C9C5BC] shrink-0"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span className="text-[11px] text-[#9E9A91] truncate">
            {listing.suburb}, {listing.region}
          </span>
        </div>

        {/* Buyer Protection micro-badge */}
        {!isSold && (
          <div className="flex items-center gap-1 mb-1.5">
            <svg
              className="text-emerald-600 shrink-0"
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span className="text-[10px] text-emerald-700 font-medium">
              Protected
            </span>
          </div>
        )}

        {/* Seller + stats row */}
        <div className="flex items-center justify-between gap-2">
          {sellerHref ? (
            <Link
              href={sellerHref}
              className="flex items-center gap-1 min-w-0 group/seller"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="w-4 h-4 rounded-full bg-[#141414] text-white text-[8px]
                  font-bold flex items-center justify-center shrink-0"
              >
                {listing.sellerName[0]}
              </div>
              <span className="text-[11px] text-[#9E9A91] truncate group-hover/seller:text-[#D4A843] transition-colors">
                {listing.sellerName}
              </span>
              {listing.sellerVerified && (
                <svg
                  className="text-[#D4A843] shrink-0"
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-label="Verified seller"
                >
                  <path d="M22 12L20.56 10.39L20.78 8.21L18.64 7.73L17.5 5.83L15.47 6.71L13.5 5.5L11.53 6.71L9.5 5.83L8.36 7.73L6.22 8.21L6.44 10.39L5 12L6.44 13.61L6.22 15.79L8.36 16.27L9.5 18.17L11.53 17.29L13.5 18.5L15.47 17.29L17.5 18.17L18.64 16.27L20.78 15.79L20.56 13.61L22 12Z" />
                  <path
                    d="M10 12L12 14L16 10"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              )}
            </Link>
          ) : (
            <div className="flex items-center gap-1 min-w-0">
              <div className="w-4 h-4 rounded-full bg-[#141414] text-white text-[8px] font-bold flex items-center justify-center shrink-0">
                {listing.sellerName[0]}
              </div>
              <span className="text-[11px] text-[#9E9A91] truncate">
                {listing.sellerName}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {listing.watcherCount > 0 && (
              <div className="flex items-center gap-0.5 text-[#9E9A91]">
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                <span className="text-[10px]">{listing.watcherCount}</span>
              </div>
            )}
            <span className="text-[10px] text-[#C9C5BC]">
              {relativeTime(listing.createdAt)}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
});
