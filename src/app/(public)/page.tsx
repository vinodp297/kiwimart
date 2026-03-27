import Link from 'next/link';
import type { Metadata } from 'next';

import db from '@/lib/db';
import CATEGORIES from '@/data/categories';
import LISTINGS from '@/data/listings';

const HIDDEN_CATEGORY_IDS = ['vehicles', 'property'];
import ListingCard from '@/components/ListingCard';
import CategoryPills from '@/components/CategoryPills';
import TrustBadge from '@/components/TrustBadge';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: "New Zealand's Trusted Marketplace",
  description:
    'Buy and sell with confidence on KiwiMart. Secure escrow payments, $3,000 buyer protection, and verified NZ sellers. Browse 120,000+ listings across Aotearoa.',
  keywords: ['marketplace', 'buy', 'sell', 'New Zealand', 'NZ', 'Trade Me alternative', 'second hand'],
  openGraph: {
    title: "KiwiMart — New Zealand's Trusted Marketplace",
    description: 'Buy and sell with confidence. Secure escrow, $3,000 buyer protection.',
    url: 'https://kiwimart.co.nz',
    siteName: 'KiwiMart',
    locale: 'en_NZ',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "KiwiMart — New Zealand's Trusted Marketplace",
  },
  alternates: {
    canonical: 'https://kiwimart.co.nz',
  },
};

// Revalidate homepage every hour
export const revalidate = 3600;

// ── Trust badge data ──────────────────────────────────────────────────────────
const TRUST_BADGES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
    title: 'Secure Escrow',
    description: 'Funds held safely until both parties confirm delivery.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    ),
    title: '$3,000 Buyer Protection',
    description: 'Full cover on every eligible purchase, no questions asked.',
    highlight: true,
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    ),
    title: 'Verified Sellers',
    description: 'ID-verified sellers with real ratings from real buyers.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
    title: 'NZ Consumer Law',
    description: 'Every transaction covered by NZ Fair Trading Act.',
  },
];

// ── Fetch real stats + featured listings from DB ──────────────────────────────
async function getHomePageData() {
  try {
    const [listingCount, memberCount, featuredListings, categoryCounts] = await Promise.all([
      db.listing.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      db.user.count({ where: { deletedAt: null } }),
      db.listing.findMany({
        where: { status: 'ACTIVE', deletedAt: null },
        orderBy: { watcherCount: 'desc' },
        take: 8,
        select: {
          id: true,
          title: true,
          priceNzd: true,
          condition: true,
          categoryId: true,
          subcategoryName: true,
          region: true,
          suburb: true,
          shippingOption: true,
          shippingNzd: true,
          offersEnabled: true,
          status: true,
          viewCount: true,
          watcherCount: true,
          createdAt: true,
          images: {
            where: { order: 0, safe: true },
            select: { r2Key: true },
            take: 1,
          },
          seller: {
            select: {
              username: true,
              displayName: true,
              idVerified: true,
            },
          },
        },
      }),
      db.listing.groupBy({
        by: ['categoryId'],
        where: { status: 'ACTIVE', deletedAt: null },
        _count: { id: true },
      }),
    ]);

    return { listingCount, memberCount, featuredListings, categoryCounts };
  } catch {
    // DB unavailable — return nulls to fall back to mock data
    return { listingCount: null, memberCount: null, featuredListings: null, categoryCounts: null };
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

// ── Section header component (server component-safe) ─────────────────────────
function SectionHeader({
  title,
  subtitle,
  href,
  hrefLabel = 'Browse all',
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </Link>
      )}
    </div>
  );
}

// ── Condition map ─────────────────────────────────────────────────────────────
const CONDITION_MAP: Record<string, string> = {
  NEW: 'new', LIKE_NEW: 'like-new', GOOD: 'good', FAIR: 'fair', PARTS: 'parts',
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function HomePage() {
  const { listingCount, memberCount, featuredListings, categoryCounts } = await getHomePageData();

  // Build real count map, filter hidden categories
  const countMap = categoryCounts
    ? Object.fromEntries(categoryCounts.map((c) => [c.categoryId, c._count.id]))
    : {};

  const visibleCategories = CATEGORIES
    .filter((cat) => !HIDDEN_CATEGORY_IDS.includes(cat.id))
    .map((cat) => ({
      ...cat,
      listingCount: countMap[cat.id] ?? cat.listingCount,
    }))
    .slice(0, 8);

  // Format stats — use real data if available, fall back to mock
  const STATS = [
    { value: listingCount != null ? formatCount(listingCount) : '248K', label: 'Active listings' },
    { value: memberCount != null ? formatCount(memberCount) : '1.2M', label: 'Members' },
    { value: '$3K', label: 'Buyer protection' },
    { value: '$0', label: 'Listing fee' },
  ];

  // Map DB listings to ListingCard shape, or fall back to mock
  const FEATURED = featuredListings
    ? featuredListings.map((row) => ({
        id: row.id,
        title: row.title,
        price: row.priceNzd / 100,
        condition: (CONDITION_MAP[row.condition] ?? 'good') as 'new' | 'like-new' | 'good' | 'fair' | 'parts',
        categoryName: row.categoryId,
        subcategoryName: row.subcategoryName ?? '',
        region: row.region as typeof LISTINGS[0]['region'],
        suburb: row.suburb,
        thumbnailUrl: row.images[0]?.r2Key
          ? (row.images[0].r2Key.startsWith('http') ? row.images[0].r2Key : `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${row.images[0].r2Key}`)
          : 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=480&h=480&fit=crop',
        sellerName: row.seller.displayName,
        sellerUsername: row.seller.username,
        sellerRating: 4.5,
        sellerVerified: row.seller.idVerified,
        viewCount: row.viewCount,
        watcherCount: row.watcherCount,
        createdAt: row.createdAt.toISOString(),
        status: row.status.toLowerCase() as 'active' | 'sold',
        shippingOption: row.shippingOption.toLowerCase() as 'courier' | 'pickup' | 'both',
        shippingPrice: row.shippingNzd != null ? row.shippingNzd / 100 : null,
        offersEnabled: row.offersEnabled,
      }))
    : [...LISTINGS].sort((a, b) => b.watcherCount - a.watcherCount).slice(0, 8);

  return (
    <>
      <NavBar />

      <main>
        {/* ══════════════════════════════════════════════════════════════════
            HERO
        ══════════════════════════════════════════════════════════════════ */}
        <section
          className="relative overflow-hidden bg-[#141414] text-white"
          aria-label="Hero"
        >
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,1) 39px,rgba(255,255,255,1) 40px),' +
                'repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,1) 39px,rgba(255,255,255,1) 40px)',
            }}
          />
          <div
            aria-hidden
            className="absolute -top-32 -right-32 w-96 h-96 rounded-full
              bg-[#D4A843]/20 blur-[100px] pointer-events-none"
          />
          <div
            aria-hidden
            className="absolute bottom-0 left-1/4 w-64 h-64 rounded-full
              bg-[#D4A843]/10 blur-[80px] pointer-events-none"
          />

          <div className="relative max-w-7xl mx-auto px-6 py-16 sm:py-24">
            <div className="max-w-2xl">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                  border border-[#D4A843]/40 bg-[#D4A843]/10 text-[#D4A843]
                  text-[11.5px] font-semibold tracking-wide uppercase mb-6"
              >
                <span aria-hidden>🥝</span> New Zealand's Marketplace
              </div>

              <h1
                className="font-[family-name:var(--font-playfair)] text-[2.5rem]
                  sm:text-[3.25rem] lg:text-[3.75rem] font-semibold leading-[1.1]
                  tracking-tight"
              >
                Buy &amp; sell with{' '}
                <em className="not-italic text-[#D4A843]">confidence</em>
              </h1>

              <p className="mt-4 text-[15.5px] text-white/65 leading-relaxed max-w-xl">
                Aotearoa's most trusted marketplace. Every transaction secured by escrow,
                every purchase backed by $3,000 buyer protection. Shop local. Shop safe.
              </p>

              <form
                action="/search"
                method="get"
                className="mt-8 flex flex-col sm:flex-row gap-2"
                role="search"
              >
                <div className="relative flex-1">
                  <input
                    name="q"
                    type="search"
                    placeholder="Search for anything…"
                    aria-label="Search listings"
                    className="w-full h-12 pl-12 pr-4 rounded-xl bg-white/10 text-white
                      placeholder:text-white/40 border border-white/20
                      focus:border-[#D4A843] focus:bg-white/15 focus:outline-none
                      focus:ring-2 focus:ring-[#D4A843]/30
                      text-[14.5px] transition"
                  />
                  <svg
                    aria-hidden
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
                    width="17" height="17" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                </div>

                <select
                  name="category"
                  aria-label="Category"
                  className="h-12 px-4 rounded-xl bg-white/10 text-white/80
                    border border-white/20 focus:border-[#D4A843] focus:outline-none
                    text-[13.5px] cursor-pointer appearance-none pr-9 min-w-[140px]
                    [background-image:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%228%22%3E%3Cpath d=%22M1 1l5 5 5-5%22 stroke=%22rgba(255,255,255,.4)%22 stroke-width=%221.5%22 fill=%22none%22 stroke-linecap=%22round%22/%3E%3C/svg%3E')]
                    [background-repeat:no-repeat] [background-position:right_14px_center]"
                >
                  <option value="">All categories</option>
                  {CATEGORIES.filter((c) => !HIDDEN_CATEGORY_IDS.includes(c.id)).map((c) => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>

                <button
                  type="submit"
                  className="h-12 px-6 rounded-xl bg-[#D4A843] text-[#141414]
                    font-semibold text-[14px] hover:bg-[#B8912E] hover:text-white
                    transition-colors duration-150 shadow-lg shadow-[#D4A843]/30
                    whitespace-nowrap"
                >
                  Search
                </button>
              </form>

              <div className="flex flex-wrap gap-2 mt-4">
                {['Laptops', 'Road bikes', 'Allbirds', 'Weber BBQ', 'Pounamu'].map((term) => (
                  <Link
                    key={term}
                    href={`/search?q=${encodeURIComponent(term)}`}
                    className="text-[11.5px] text-white/50 hover:text-[#D4A843]
                      transition-colors duration-150"
                  >
                    {term}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* STATS STRIP */}
        <section
          aria-label="Platform statistics"
          className="bg-[#F8F7F4] border-b border-[#E3E0D9]"
        >
          <div className="max-w-7xl mx-auto px-6">
            <dl className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0
              divide-[#E3E0D9]">
              {STATS.map(({ value, label }) => (
                <div key={label} className="flex flex-col items-center py-5 gap-0.5">
                  <dt
                    className="font-[family-name:var(--font-playfair)] text-[1.75rem]
                      font-semibold text-[#141414] leading-none"
                  >
                    {value}
                  </dt>
                  <dd className="text-[12px] text-[#73706A] font-medium">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* CATEGORIES */}
        <section
          aria-labelledby="categories-heading"
          className="max-w-7xl mx-auto px-6 pt-14 pb-0"
        >
          <SectionHeader
            title="Browse by category"
            subtitle="Find exactly what you're looking for across Aotearoa"
            href="/search"
            hrefLabel="All categories"
          />
          <CategoryPills categories={visibleCategories} />
        </section>

        {/* TRUST BADGES */}
        <section
          aria-labelledby="trust-heading"
          className="max-w-7xl mx-auto px-6 pt-14"
        >
          <SectionHeader
            title="Why KiwiMart?"
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
            {FEATURED.map((listing) => (
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </Link>
          </div>
        </section>

        {/* SELL CTA BAND */}
        <section
          aria-label="Sell on KiwiMart"
          className="bg-[#141414] text-white"
        >
          <div className="max-w-7xl mx-auto px-6 py-14 flex flex-col sm:flex-row
            items-center justify-between gap-8">
            <div>
              <h2
                className="font-[family-name:var(--font-playfair)] text-[1.75rem]
                  sm:text-[2.25rem] font-semibold leading-tight"
              >
                Ready to sell?{' '}
                <em className="not-italic text-[#D4A843]">It's free.</em>
              </h2>
              <p className="mt-2 text-[14px] text-white/60 max-w-md">
                List your item in under 2 minutes. $0 listing fee. Secure payment straight
                to your bank once the buyer confirms receipt.
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
