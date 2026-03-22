'use client';
// src/app/(public)/listings/[id]/SellerPanel.tsx

import Link from 'next/link';
import type { SellerPublic, SellerBadge } from '@/types';
import { Avatar, StarRating, Button } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/utils';

const BADGE_CONFIG: Record<SellerBadge, { label: string; icon: string; colour: string }> = {
  top_seller:      { label: 'Top Seller',      icon: '🏆', colour: 'bg-amber-50 text-amber-700 ring-amber-200' },
  fast_responder:  { label: 'Fast Responder',   icon: '⚡', colour: 'bg-sky-50 text-sky-700 ring-sky-200' },
  verified_id:     { label: 'Verified ID',      icon: '✓',  colour: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  trusted_seller:  { label: 'Trusted Seller',   icon: '🛡',  colour: 'bg-violet-50 text-violet-700 ring-violet-200' },
  nz_business:     { label: 'NZ Business',      icon: '🥝', colour: 'bg-[#F5ECD4] text-[#8B6914] ring-[#D4A843]/40' },
};

interface Props {
  seller: SellerPublic;
  listingId: string;
}

export default function SellerPanel({ seller, listingId }: Props) {
  const memberSince = new Date(seller.memberSince).getFullYear();

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
      <h2 className="font-[family-name:var(--font-playfair)] text-[1rem]
        font-semibold text-[#141414] mb-4">
        About the seller
      </h2>

      {/* Seller info row */}
      <div className="flex items-start gap-3 mb-4">
        <Link href={`/sellers/${seller.username}`} tabIndex={-1}>
          <Avatar name={seller.displayName} src={seller.avatarUrl} size="lg" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={`/sellers/${seller.username}`}
            className="font-semibold text-[#141414] text-[14px] hover:text-[#D4A843]
              transition-colors block truncate"
          >
            {seller.displayName}
          </Link>
          <p className="text-[12px] text-[#9E9A91] mt-0.5">
            Member since {memberSince} · {seller.soldCount} sold
          </p>
          <div className="mt-1.5">
            <StarRating
              rating={seller.rating}
              reviewCount={seller.reviewCount}
              size="sm"
            />
          </div>
        </div>
      </div>

      {/* Badges */}
      {seller.badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {seller.badges.map((badge) => {
            const cfg = BADGE_CONFIG[badge];
            return (
              <span
                key={badge}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                  text-[10.5px] font-semibold ring-1 ${cfg.colour}`}
              >
                <span aria-hidden>{cfg.icon}</span>
                {cfg.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Response time */}
      <div className="flex items-center gap-2 text-[12px] text-[#73706A] mb-4">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        {seller.responseTimeLabel}
      </div>

      {/* Bio */}
      {seller.bio && (
        <p className="text-[12.5px] text-[#73706A] leading-relaxed mb-4 border-t border-[#F0EDE8] pt-4">
          {seller.bio}
        </p>
      )}

      {/* CTA buttons */}
      <div className="space-y-2">
        <Link href={`/messages/new?listingId=${listingId}&sellerId=${seller.id}`}>
          <Button variant="secondary" fullWidth size="sm">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Message seller
          </Button>
        </Link>
        <Link href={`/sellers/${seller.username}`}>
          <Button variant="ghost" fullWidth size="sm">
            View all listings ({seller.activeListingCount})
          </Button>
        </Link>
      </div>
    </div>
  );
}

