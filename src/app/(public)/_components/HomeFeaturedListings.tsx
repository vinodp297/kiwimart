// src/app/(public)/_components/HomeFeaturedListings.tsx
// ─── Featured listings grid + sell CTA band ───────────────────────────────────
// Server component — receives the pre-mapped listing array as props.

import Link from "next/link";
import ListingCard from "@/components/ListingCard";
import type { ListingCard as ListingCardType } from "@/types";

// ── Section header (server component-safe) ────────────────────────────────────
function SectionHeader({
  title,
  subtitle,
  href,
  hrefLabel = "Browse all",
}: {
  title: string;
  subtitle?: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <div>
        <h2
          className="font-[family-name:var(--font-playfair)] text-[1.5rem] sm:text-[1.75rem]
            font-semibold text-[#141414] leading-tight"
        >
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-[13.5px] text-[#73706A]">{subtitle}</p>
        )}
      </div>
      {href && (
        <Link
          href={href}
          className="shrink-0 flex items-center gap-1.5 text-[13px] font-semibold
            text-[#D4A843] hover:text-[#B8912E] transition-colors duration-150"
        >
          {hrefLabel}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  featured: ListingCardType[];
}

export default function HomeFeaturedListings({ featured }: Props) {
  return (
    <>
      {/* FEATURED LISTINGS */}
      <section
        aria-labelledby="featured-heading"
        className="max-w-7xl mx-auto px-6 pt-14 pb-16"
      >
        <SectionHeader
          title="Featured listings"
          subtitle="Hand-picked items from trusted NZ sellers"
          href="/search?sort=most-watched"
          hrefLabel="Browse all"
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {featured.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
        <div className="flex justify-center mt-10">
          <Link
            href="/search"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full
              bg-[#141414] text-white font-semibold text-[14px]
              hover:bg-[#D4A843] transition-colors duration-200 shadow-md"
          >
            View all listings
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      {/* SELL CTA BAND */}
      <section
        aria-label={`Sell on ${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}`}
        className="bg-[#141414] text-white"
      >
        <div
          className="max-w-7xl mx-auto px-6 py-14 flex flex-col sm:flex-row
          items-center justify-between gap-8"
        >
          <div>
            <h2
              className="font-[family-name:var(--font-playfair)] text-[1.75rem]
                sm:text-[2.25rem] font-semibold leading-tight"
            >
              Ready to sell?{" "}
              <em className="not-italic text-[#D4A843]">It&apos;s free.</em>
            </h2>
            <p className="mt-2 text-[14px] text-white/60 max-w-md">
              List your item in under 2 minutes. $0 listing fee. Secure payment
              straight to your bank once the buyer confirms receipt.
            </p>
          </div>
          <Link
            href="/sell"
            className="shrink-0 inline-flex items-center gap-2 px-8 py-4
              bg-[#D4A843] text-[#141414] font-semibold text-[15px] rounded-full
              hover:bg-[#F5C84A] transition-colors duration-150 shadow-lg
              shadow-[#D4A843]/30 whitespace-nowrap"
          >
            Start selling
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>
    </>
  );
}
