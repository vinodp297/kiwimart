'use client';
// src/components/ListingCard.tsx  (Sprint 2 update)
// ─── Listing Card ─────────────────────────────────────────────────────────────
// Changes from Sprint 1:
//   • sellerUsername field used for /sellers/[username] link
//   • status badge (sold overlay)
//   • shippingOption displayed (free shipping badge)
//   • offersEnabled chip
//   • Graceful fallback for listings without sellerUsername

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { ListingCard as ListingCardType } from '@/types';
import { formatPrice, relativeTime, CONDITION_LABELS, CONDITION_COLOURS } from '@/lib/utils';

interface Props {
  listing: ListingCardType;
  priority?: boolean;
}

export default function ListingCard({ listing, priority = false }: Props) {
  const [watched, setWatched] = useState(false);

  const isSold = listing.status === 'sold';
  const isFree = listing.shippingPrice === 0;
  const sellerHref = listing.sellerUsername
    ? `/sellers/${listing.sellerUsername}`
    : undefined;

  return (
    <article
      className="group relative bg-white rounded-2xl border border-[#E3E0D9]
        overflow-hidden hover:shadow-lg hover:-translate-y-0.5
        transition-all duration-200 flex flex-col"
    >
      {/* ── Image ──────────────────────────────────────────────────────── */}
      <Link href={`/listings/${listing.id}`} className="block relative" tabIndex={-1}>
        <div className="relative aspect-square bg-[#F8F7F4] overflow-hidden">
          <Image
            src={listing.thumbnailUrl}
            alt={listing.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className={`object-cover transition-transform duration-300
              ${isSold ? 'opacity-60' : 'group-hover:scale-105'}`}
            priority={priority}
          />

          {/* Sold overlay */}
          {isSold && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="bg-white text-[#141414] text-[11px] font-bold px-2.5 py-1 rounded-full">
                SOLD
              </span>
            </div>
          )}

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
              setWatched((w) => !w);
              // Sprint 3: await toggleWatch(listing.id)
            }}
            aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            aria-pressed={watched}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90
              backdrop-blur-sm shadow-sm flex items-center justify-center
              opacity-0 group-hover:opacity-100 transition-all duration-150
              hover:scale-110 border border-[#E3E0D9]"
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24"
              fill={watched ? '#D4A843' : 'none'}
              stroke={watched ? '#D4A843' : '#73706A'}
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
              ${CONDITION_COLOURS[listing.condition]}`}
          >
            {CONDITION_LABELS[listing.condition]}
          </span>
          {listing.offersEnabled && !isSold && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full
              text-[9.5px] font-semibold bg-[#F5ECD4] text-[#8B6914] ring-1 ring-[#D4A843]/30">
              Offers
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
            width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span className="text-[11px] text-[#9E9A91] truncate">
            {listing.suburb}, {listing.region}
          </span>
        </div>

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
                  width="9" height="9" viewBox="0 0 24 24" fill="currentColor"
                  aria-label="Verified seller"
                >
                  <path d="M22 12L20.56 10.39L20.78 8.21L18.64 7.73L17.5 5.83L15.47 6.71L13.5 5.5L11.53 6.71L9.5 5.83L8.36 7.73L6.22 8.21L6.44 10.39L5 12L6.44 13.61L6.22 15.79L8.36 16.27L9.5 18.17L11.53 17.29L13.5 18.5L15.47 17.29L17.5 18.17L18.64 16.27L20.78 15.79L20.56 13.61L22 12Z" />
                  <path d="M10 12L12 14L16 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              )}
            </Link>
          ) : (
            <div className="flex items-center gap-1 min-w-0">
              <div className="w-4 h-4 rounded-full bg-[#141414] text-white text-[8px] font-bold flex items-center justify-center shrink-0">
                {listing.sellerName[0]}
              </div>
              <span className="text-[11px] text-[#9E9A91] truncate">{listing.sellerName}</span>
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {listing.watcherCount > 0 && (
              <div className="flex items-center gap-0.5 text-[#9E9A91]">
                <svg
                  width="9" height="9" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
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
}

