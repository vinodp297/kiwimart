// src/components/listings/RecentlySoldSection.tsx
// ─── Recently Sold Section ────────────────────────────────────────────────────
// Server component. Fetches its own data via server action.
// Returns null when there are no recently sold listings (no empty state shown).

import Image from "next/image";
import { getRecentlySold } from "@/server/actions/listings";
import { getImageUrl } from "@/lib/image";
import { relativeTime } from "@/lib/utils";
import { formatPrice } from "@/lib/utils";

// ── Individual sold card ──────────────────────────────────────────────────────

interface SoldCardProps {
  id: string;
  title: string;
  /** Total paid, in NZD cents */
  soldForNzd: number;
  /** Listing price, in NZD cents */
  priceNzd: number;
  thumbnailUrl: string;
  completedAt: Date;
  region: string;
  suburb: string | null;
}

function SoldCard({
  title,
  soldForNzd,
  thumbnailUrl,
  completedAt,
  region,
  suburb,
}: SoldCardProps) {
  return (
    <article
      className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden
        flex-shrink-0 w-[180px] sm:w-auto"
    >
      {/* Image with SOLD overlay */}
      <div className="relative aspect-square overflow-hidden bg-[#F5F4F0]">
        <Image
          src={thumbnailUrl}
          alt={title}
          fill
          sizes="(max-width: 640px) 180px, 25vw"
          className="object-cover opacity-60"
        />
        <div
          className="absolute inset-0 flex items-center justify-center"
          aria-label="Sold"
        >
          <span
            className="px-2 py-0.5 rounded-full bg-[#141414]/80 text-white
              text-[11px] font-semibold tracking-wide uppercase"
          >
            Sold
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="p-3">
        <p
          className="text-[12.5px] font-medium text-[#141414] leading-tight line-clamp-2 mb-1"
          title={title}
        >
          {title}
        </p>
        <p className="text-[12px] font-semibold text-[#D4A843]">
          Sold for {formatPrice(soldForNzd)}
        </p>
        <p className="text-[11px] text-[#9E9A91] mt-0.5">
          {relativeTime(completedAt.toISOString())}
        </p>
        <p className="text-[11px] text-[#C9C5BC]">
          {suburb ? `${suburb}, ${region}` : region}
        </p>
      </div>
    </article>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export async function RecentlySoldSection() {
  const result = await getRecentlySold(8);

  // Empty state — render nothing so the page layout doesn't leave a gap
  if (!result.success || result.data.length === 0) {
    return null;
  }

  const items = result.data;

  return (
    <section
      aria-labelledby="recently-sold-heading"
      className="max-w-7xl mx-auto px-6 pt-14 pb-10"
    >
      {/* Section header */}
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h2
            id="recently-sold-heading"
            className="font-[family-name:var(--font-playfair)] text-[1.5rem] sm:text-[1.75rem]
              font-semibold text-[#141414] leading-tight"
          >
            Recently sold
          </h2>
          <p className="mt-1 text-[13.5px] text-[#73706A]">
            See what&apos;s selling across Aotearoa
          </p>
        </div>
      </div>

      {/* Horizontal scroll on mobile, grid on desktop */}
      <div
        className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1
          sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0"
      >
        {items.map((item) => {
          const listing = item.listing;
          if (!listing) return null;
          return (
            <SoldCard
              key={`${listing.id}-${item.completedAt?.toISOString()}`}
              id={listing.id}
              title={listing.title}
              soldForNzd={item.totalNzd}
              priceNzd={listing.priceNzd}
              thumbnailUrl={getImageUrl(listing.images[0]?.r2Key ?? null)}
              completedAt={item.completedAt ?? new Date()}
              region={listing.region}
              suburb={listing.suburb}
            />
          );
        })}
      </div>
    </section>
  );
}

export default RecentlySoldSection;
