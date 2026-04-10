// src/app/(public)/_components/HomeCategories.tsx
// ─── Category pills + trust badges sections ───────────────────────────────────
// Server component — receives the pre-computed category list with live counts.

import CategoryPills from "@/components/CategoryPills";
import TrustBadge from "@/components/TrustBadge";
import type { Category } from "@/types";

// ── Section header (server component-safe) ────────────────────────────────────
function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
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
    </div>
  );
}

// ── Trust badge data ──────────────────────────────────────────────────────────
const TRUST_BADGES = [
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    title: "Secure Escrow",
    description: "Funds held safely until both parties confirm delivery.",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
    title: `${process.env.NEXT_PUBLIC_BUYER_PROTECTION_DISPLAY ?? "$3,000"} Buyer Protection`,
    description: "Full cover on every eligible purchase, no questions asked.",
    highlight: true,
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    title: "Verified Sellers",
    description: "ID-verified sellers with real ratings from real buyers.",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    title: "NZ Consumer Law",
    description: "Every transaction covered by NZ Fair Trading Act.",
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  categories: Category[];
}

export default function HomeCategories({ categories }: Props) {
  return (
    <>
      {/* CATEGORIES */}
      <section
        aria-labelledby="categories-heading"
        className="max-w-7xl mx-auto px-6 pt-14 pb-0"
      >
        <SectionHeader
          title="Browse by category"
          subtitle="Find exactly what you're looking for across Aotearoa"
        />
        <CategoryPills categories={categories} />
      </section>

      {/* TRUST BADGES */}
      <section
        aria-labelledby="trust-heading"
        className="max-w-7xl mx-auto px-6 pt-14"
      >
        <SectionHeader
          title={`Why ${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}?`}
          subtitle="Your safety is our priority on every transaction"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {TRUST_BADGES.map((badge) => (
            <TrustBadge
              key={badge.title}
              icon={badge.icon}
              title={badge.title}
              description={badge.description}
              highlight={badge.highlight}
            />
          ))}
        </div>
      </section>
    </>
  );
}
