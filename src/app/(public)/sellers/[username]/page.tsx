// src/app/(public)/sellers/[username]/page.tsx
// ─── Public Seller Profile Page ───────────────────────────────────────────────

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import ListingCard from '@/components/ListingCard';
import { Avatar, StarRating, Breadcrumb } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/utils';
import type { SellerBadge, NZRegion, Review, ListingCard as ListingCardType } from '@/types';
import db from '@/lib/db';
import { getImageUrl, getDefaultAvatar } from '@/lib/image';
import { auth } from '@/lib/auth';
import { BlockButton } from '@/components/seller/BlockButton';

const BADGE_CONFIG: Record<SellerBadge, { label: string; colour: string }> = {
  top_seller:     { label: '🏆 Top Seller',      colour: 'bg-amber-50 text-amber-700 ring-amber-200' },
  fast_responder: { label: '⚡ Fast Responder',   colour: 'bg-sky-50 text-sky-700 ring-sky-200' },
  verified_id:    { label: '✓ Verified ID',       colour: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  trusted_seller: { label: '🛡 Trusted Seller',   colour: 'bg-violet-50 text-violet-700 ring-violet-200' },
  nz_business:    { label: '🥝 NZ Business',      colour: 'bg-[#F5ECD4] text-[#8B6914] ring-[#D4A843]/40' },
};

async function getSellerByUsername(username: string) {
  return db.user.findUnique({
    where: { username, deletedAt: null, isBanned: false },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarKey: true,
      coverImageKey: true,
      bio: true,
      region: true,
      suburb: true,
      idVerified: true,
      createdAt: true,
      _count: {
        select: {
          sellerOrders: { where: { status: 'COMPLETED' } },
          listings: { where: { status: 'ACTIVE', deletedAt: null } },
          reviews: true,
        },
      },
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          sellerReply: true,
          author: { select: { displayName: true, username: true, avatarKey: true } },
          order: { select: { listing: { select: { title: true } } } },
        },
      },
    },
  });
}

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const user = await getSellerByUsername(username);
  if (!user) return { title: 'Seller not found — KiwiMart' };
  return {
    title: `${user.displayName} — KiwiMart Seller`,
    description: `${user.displayName} is a ${user.idVerified ? 'verified' : ''} NZ seller on KiwiMart with ${user._count.reviews} reviews.`,
  };
}

export default async function SellerProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const [user, session] = await Promise.all([
    getSellerByUsername(username),
    auth(),
  ]);
  if (!user) notFound();

  const currentUserId = session?.user?.id ?? null;

  // Check if logged-in viewer has blocked this seller
  let isBlocked = false;
  if (currentUserId && currentUserId !== user.id) {
    try {
      const block = await db.blockedUser.findFirst({
        where: { blockerId: currentUserId, blockedId: user.id },
        select: { id: true },
      });
      isBlocked = !!block;
    } catch {
      // Fail-safe: block check failure → treat as not blocked, page still loads
    }
  }

  // Compute avg rating from reviews
  const avgRating = user.reviews.length > 0
    ? user.reviews.reduce((sum, r) => sum + r.rating, 0) / user.reviews.length / 10
    : 0;

  // Map DB reviews to Review type — guard against orphaned author FKs
  const reviews: Review[] = user.reviews
    .filter((r) => r.author != null) // skip reviews whose author was hard-deleted
    .map((r) => ({
      id: r.id,
      buyerName: r.author?.displayName ?? 'KiwiMart user',
      buyerUsername: r.author?.username ?? '',
      buyerAvatarUrl: r.author?.avatarKey ? getImageUrl(r.author.avatarKey) : null,
      rating: r.rating / 10, // DB stores 1-50, display as 0.1-5.0
      comment: r.comment ?? '',
      listingTitle: r.order?.listing?.title ?? 'Unknown listing',
      createdAt: r.createdAt.toISOString(),
      sellerReply: r.sellerReply,
    }));

  // Build seller shape for display
  const seller = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarKey
      ? getImageUrl(user.avatarKey)
      : getDefaultAvatar(user.idVerified ? 'id_verified' : undefined),
    coverImageUrl: user.coverImageKey ? getImageUrl(user.coverImageKey) : null,
    bio: user.bio,
    region: (user.region ?? 'Auckland') as NZRegion,
    suburb: user.suburb ?? '',
    rating: avgRating,
    reviewCount: user._count.reviews,
    verified: user.idVerified,
    memberSince: user.createdAt.toISOString(),
    activeListingCount: user._count.listings,
    soldCount: user._count.sellerOrders,
    responseTimeLabel: user._count.sellerOrders >= 5 ? 'Usually replies within 1 hour' : null,
    badges: (user.idVerified ? ['verified_id'] : []) as SellerBadge[],
  };

  // Fetch seller's active listings
  let sellerListings: ListingCardType[] = [];
  try {
    // We can't filter searchListings by sellerId directly, so use a raw query approach
    const listingRows = await db.listing.findMany({
      where: { sellerId: user.id, status: 'ACTIVE', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        id: true, title: true, priceNzd: true, condition: true,
        categoryId: true, subcategoryName: true, region: true, suburb: true,
        shippingOption: true, shippingNzd: true, offersEnabled: true,
        status: true, viewCount: true, watcherCount: true, createdAt: true,
        images: { where: { order: 0, safe: true }, select: { r2Key: true }, take: 1 },
      },
    });

    const condMap: Record<string, ListingCardType['condition']> = {
      NEW: 'new', LIKE_NEW: 'like-new', GOOD: 'good', FAIR: 'fair', PARTS: 'parts',
    };

    sellerListings = listingRows.map((row) => ({
      id: row.id,
      title: row.title,
      price: row.priceNzd / 100,
      condition: condMap[row.condition] ?? 'good',
      categoryName: row.categoryId,
      subcategoryName: row.subcategoryName ?? '',
      region: row.region as NZRegion,
      suburb: row.suburb,
      thumbnailUrl: getImageUrl(row.images[0]?.r2Key ?? null),
      sellerName: user.displayName,
      sellerUsername: user.username,
      sellerRating: seller.rating,
      sellerVerified: user.idVerified,
      viewCount: row.viewCount,
      watcherCount: row.watcherCount,
      createdAt: row.createdAt.toISOString(),
      status: row.status.toLowerCase() as ListingCardType['status'],
      shippingOption: row.shippingOption.toLowerCase() as ListingCardType['shippingOption'],
      shippingPrice: row.shippingNzd != null ? row.shippingNzd / 100 : null,
      offersEnabled: row.offersEnabled,
    }));
  } catch {
    // Fallback to empty
  }

  const memberSince = new Date(seller.memberSince);

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <Breadcrumb
            items={[
              { label: 'Home', href: '/' },
              { label: 'Sellers' },
              { label: seller.displayName },
            ]}
          />

          {/* ── Hero band ──────────────────────────────────────────────────── */}
          <div
            className="relative mt-5 rounded-2xl overflow-hidden bg-[#141414]
              text-white p-6 sm:p-8"
            style={seller.coverImageUrl ? {
              backgroundImage: `url(${seller.coverImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            } : undefined}
          >
            {/* Overlay to keep text readable over cover images */}
            {seller.coverImageUrl && (
              <div
                aria-hidden
                className="absolute inset-0 bg-[#141414]/70 backdrop-blur-[1px]
                  pointer-events-none"
              />
            )}

            {/* Gold glow (only shown without cover image) */}
            {!seller.coverImageUrl && (
              <div
                aria-hidden
                className="absolute -top-20 -right-20 w-72 h-72 rounded-full
                  bg-[#D4A843]/15 blur-[80px] pointer-events-none"
              />
            )}

            <div className="relative flex flex-col sm:flex-row items-start
              sm:items-center gap-5">
              {/* Avatar */}
              <Avatar
                name={seller.displayName}
                src={seller.avatarUrl}
                size="xl"
                className="ring-4 ring-[#D4A843]/30"
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h1 className="font-[family-name:var(--font-playfair)] text-[1.6rem]
                    font-semibold leading-tight">
                    {seller.displayName}
                  </h1>
                  {seller.verified && (
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-0.5
                        bg-[#D4A843]/20 text-[#D4A843] text-[11px] font-semibold
                        rounded-full ring-1 ring-[#D4A843]/30"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="#D4A843">
                        <path d="M22 12L20.56 10.39L20.78 8.21L18.64 7.73L17.5 5.83L15.47 6.71L13.5 5.5L11.53 6.71L9.5 5.83L8.36 7.73L6.22 8.21L6.44 10.39L5 12L6.44 13.61L6.22 15.79L8.36 16.27L9.5 18.17L11.53 17.29L13.5 18.5L15.47 17.29L17.5 18.17L18.64 16.27L20.78 15.79L20.56 13.61L22 12Z"/>
                        <path d="M10 12L12 14L16 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                      </svg>
                      Verified
                    </span>
                  )}
                </div>

                <p className="text-[13px] text-white/50 mb-3">
                  {seller.suburb}, {seller.region} · Member since{' '}
                  {memberSince.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' })}
                </p>

                {/* Stats row */}
                <div className="flex flex-wrap gap-6">
                  {[
                    { value: seller.soldCount.toLocaleString('en-NZ'), label: 'Items sold' },
                    { value: seller.activeListingCount.toString(), label: 'Active listings' },
                    seller.reviewCount > 0
                      ? { value: `${seller.rating.toFixed(1)} ★`, label: `${seller.reviewCount} reviews` }
                      : { value: '—', label: 'No reviews yet' },
                    seller.responseTimeLabel
                      ? { value: seller.responseTimeLabel.replace('Usually replies ', ''), label: 'Response time' }
                      : { value: '—', label: 'New seller' },
                  ].map(({ value, label }) => (
                    <div key={label}>
                      <p className="text-[#D4A843] font-[family-name:var(--font-playfair)]
                        text-[1.25rem] font-semibold leading-none">
                        {value}
                      </p>
                      <p className="text-[11.5px] text-white/50 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons — hide for own profile */}
              {currentUserId === seller.id ? (
                <Link
                  href="/account/settings"
                  className="flex items-center gap-2 h-9 px-4 rounded-xl bg-white/10
                    hover:bg-white/20 text-white text-[12.5px] font-semibold
                    transition-colors border border-white/20 shrink-0 self-start"
                >
                  ✏️ Edit profile
                </Link>
              ) : (
                <div className="flex gap-2 shrink-0 self-start">
                  <Link
                    href={`/messages/new?sellerId=${seller.id}`}
                    className="flex items-center gap-2 h-9 px-4 rounded-xl bg-white/10
                      hover:bg-white/20 text-white text-[12.5px] font-semibold
                      transition-colors border border-white/20"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    Message
                  </Link>
                  <Link
                    href={`/report?user=${seller.id}`}
                    className="flex items-center gap-2 h-9 px-4 rounded-xl bg-white/5
                      hover:bg-red-500/20 text-white/50 hover:text-red-400 text-[12.5px]
                      font-semibold transition-colors border border-white/10"
                    title="Report this user"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                      <line x1="4" y1="22" x2="4" y2="15" />
                    </svg>
                    Report
                  </Link>
                  {currentUserId && (
                    <BlockButton targetUserId={seller.id} initialBlocked={isBlocked} />
                  )}
                </div>
              )}
            </div>

            {/* Bio */}
            {seller.bio && (
              <p className="relative mt-5 pt-5 border-t border-white/10
                text-[13px] text-white/60 leading-relaxed max-w-2xl">
                {seller.bio}
              </p>
            )}

            {/* Badges */}
            {seller.badges.length > 0 && (
              <div className="relative flex flex-wrap gap-2 mt-4">
                {seller.badges.map((badge) => {
                  const cfg = BADGE_CONFIG[badge];
                  return (
                    <span
                      key={badge}
                      className={`inline-flex items-center px-2.5 py-1 rounded-full
                        text-[11px] font-semibold ring-1 ${cfg.colour}`}
                    >
                      {cfg.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Two column content ─────────────────────────────────────────── */}
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">

            {/* ── Left: Listings ─────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-[family-name:var(--font-playfair)] text-[1.25rem]
                  font-semibold text-[#141414]">
                  Active listings
                  <span className="ml-2 text-[0.9rem] text-[#9E9A91] font-normal">
                    ({sellerListings.length})
                  </span>
                </h2>
              </div>

              {sellerListings.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {sellerListings.map((l) => (
                    <ListingCard key={l.id} listing={l} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-white rounded-2xl border
                  border-dashed border-[#C9C5BC]">
                  <p className="text-[14px] text-[#9E9A91]">No active listings</p>
                </div>
              )}
            </div>

            {/* ── Right: Reviews ─────────────────────────────────────────── */}
            <div>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-playfair)] text-[1.25rem]
                  font-semibold text-[#141414]">
                  Reviews
                </h2>
                {reviews.length > 0 && (
                  <StarRating rating={seller.rating} reviewCount={seller.reviewCount} />
                )}
              </div>

              {reviews.length === 0 ? (
                <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 text-center">
                  <p className="text-[13.5px] text-[#9E9A91]">No reviews yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reviews.map((review) => (
                    <article
                      key={review.id}
                      className="bg-white rounded-2xl border border-[#E3E0D9] p-4"
                    >
                      {/* Reviewer info */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            name={review.buyerName}
                            src={review.buyerAvatarUrl}
                            size="sm"
                          />
                          <div>
                            <p className="text-[12.5px] font-semibold text-[#141414]">
                              {review.buyerName}
                            </p>
                            <p className="text-[11px] text-[#9E9A91]">
                              {relativeTime(review.createdAt)}
                            </p>
                          </div>
                        </div>
                        <StarRating rating={review.rating} showCount={false} size="sm" />
                      </div>

                      {/* Comment */}
                      <p className="text-[13px] text-[#73706A] leading-relaxed mb-2">
                        {review.comment}
                      </p>

                      {/* Listing ref */}
                      <p className="text-[11px] text-[#C9C5BC] italic">
                        Re: {review.listingTitle}
                      </p>

                      {/* Seller reply */}
                      {review.sellerReply && (
                        <div
                          className="mt-3 pl-3 border-l-2 border-[#D4A843]/50
                            text-[12px] text-[#73706A] leading-relaxed"
                        >
                          <span className="font-semibold text-[#141414]">
                            {seller.displayName}:{' '}
                          </span>
                          {review.sellerReply}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

