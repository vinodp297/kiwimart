// src/app/(public)/listings/[id]/page.tsx
// ─── Listing Detail Page ──────────────────────────────────────────────────────

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import ListingCard from '@/components/ListingCard';
import { Breadcrumb } from '@/components/ui/primitives';
import { formatPrice, CONDITION_LABELS, relativeTime } from '@/lib/utils';
import ListingGallery from './ListingGallery';
import ListingActions from './ListingActions';
import SellerPanel from './SellerPanel';
import ShippingEstimate from './ShippingEstimate';
import { getListingById } from '@/server/actions/listings';
import { searchListings } from '@/server/actions/search';
import { getSellerResponseTime } from '@/modules/listings/seller-response.service';
import SafetyBanner from '@/components/SafetyBanner';
import type { ListingDetail, SellerPublic, ListingImage, ListingAttribute, Condition, NZRegion, SellerBadge } from '@/types';
import { getImageUrl as r2Url } from '@/lib/image';

export const revalidate = 60;

function mapCondition(c: string): Condition {
  const map: Record<string, Condition> = {
    NEW: 'new', LIKE_NEW: 'like-new', GOOD: 'good', FAIR: 'fair', PARTS: 'parts',
  };
  return map[c] ?? 'good';
}

// ── Metadata ──────────────────────────────────────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListingById(id);
  if (!listing) return { title: 'Listing not found — KiwiMart' };

  const price = listing.priceNzd / 100;
  const condition = mapCondition(listing.condition);
  const thumb = listing.images[0]?.r2Key ? r2Url(listing.images[0].r2Key) : undefined;

  return {
    title: `${listing.title} — KiwiMart`,
    description: `Buy ${listing.title} for ${formatPrice(price)} NZD. ${CONDITION_LABELS[condition]} condition. ${listing.region}, NZ.`,
    openGraph: {
      title: listing.title,
      description: `${formatPrice(price)} NZD · ${CONDITION_LABELS[condition]} · ${listing.region}`,
      ...(thumb ? { images: [thumb] } : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const listing = await getListingById(id);
  if (!listing) notFound();

  // Map DB row to ListingDetail shape for child components
  const condition = mapCondition(listing.condition);
  const price = listing.priceNzd / 100;

  const images: ListingImage[] = listing.images.length > 0
    ? listing.images.map((img) => ({
        id: img.id,
        url: r2Url(img.r2Key),
        altText: listing.title,
        order: img.order,
      }))
    : [{ id: `${id}-img0`, url: r2Url(null), altText: listing.title, order: 0 }];

  const attributes: ListingAttribute[] = listing.attrs.map((a) => ({
    label: a.label,
    value: a.value,
  }));
  // Always include condition + category in attributes if not already present
  if (!attributes.find((a) => a.label === 'Condition')) {
    attributes.unshift({ label: 'Condition', value: CONDITION_LABELS[condition] });
  }

  const responseTimeLabel =
    (await getSellerResponseTime(listing.seller.id)) ?? 'Response time unknown';

  const seller: SellerPublic = {
    id: listing.seller.id,
    username: listing.seller.username,
    displayName: listing.seller.displayName,
    avatarUrl: listing.seller.avatarKey ? r2Url(listing.seller.avatarKey) : null,
    bio: listing.seller.bio,
    region: (listing.seller.region ?? listing.region) as NZRegion,
    suburb: listing.seller.suburb ?? listing.suburb,
    rating: 4.5, // Sprint 5: compute from reviews aggregate
    reviewCount: 0, // Sprint 5: compute
    verified: listing.seller.idVerified,
    memberSince: listing.seller.createdAt.toISOString(),
    activeListingCount: listing.seller._count.listings,
    soldCount: listing.seller._count.sellerOrders,
    responseTimeLabel,
    badges: (listing.seller.idVerified ? ['verified_id'] : []) as SellerBadge[],
  };

  const detail: ListingDetail = {
    id: listing.id,
    title: listing.title,
    price,
    condition,
    categoryName: listing.categoryId,
    subcategoryName: listing.subcategoryName ?? '',
    region: listing.region as NZRegion,
    suburb: listing.suburb,
    thumbnailUrl: images[0].url,
    sellerName: listing.seller.displayName,
    sellerUsername: listing.seller.username,
    sellerRating: seller.rating,
    sellerVerified: listing.seller.idVerified,
    viewCount: listing.viewCount,
    watcherCount: listing.watcherCount,
    createdAt: listing.createdAt.toISOString(),
    status: listing.status.toLowerCase() as ListingDetail['status'],
    shippingOption: listing.shippingOption.toLowerCase() as ListingDetail['shippingOption'],
    shippingPrice: listing.shippingNzd != null ? listing.shippingNzd / 100 : null,
    offersEnabled: listing.offersEnabled,
    description: listing.description ?? 'No description provided.',
    images,
    attributes,
    seller,
    relatedListings: [],
    offerCount: 0,
    gstIncluded: listing.gstIncluded,
    pickupAddress: listing.pickupAddress,
  };

  // Fetch related listings from same category
  let relatedListings = detail.relatedListings;
  try {
    const related = await searchListings({
      category: listing.categoryId,
      pageSize: 5,
      sort: 'most-watched',
    });
    relatedListings = related.listings.filter((l) => l.id !== id).slice(0, 4);
  } catch {
    // Fallback to empty
  }

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Browse', href: '/search' },
    { label: detail.categoryName, href: `/search?category=${detail.categoryName.toLowerCase().replace(/\s+&\s+|-/g, '-').replace(/\s+/g, '-')}` },
    { label: detail.title.length > 40 ? detail.title.slice(0, 40) + '…' : detail.title },
  ];

  // JSON-LD structured data for Google rich results
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    description: listing.description ?? listing.title,
    image: images[0]?.url,
    offers: {
      '@type': 'Offer',
      price: price.toFixed(2),
      priceCurrency: 'NZD',
      availability:
        listing.status === 'ACTIVE'
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      seller: {
        '@type': 'Person',
        name: listing.seller.displayName,
      },
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <NavBar />

      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {/* Breadcrumb */}
          <Breadcrumb items={breadcrumbs} />

          {/* ── Main 2-col layout ─────────────────────────────────────────── */}
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">

            {/* ── Left column ────────────────────────────────────────────── */}
            <div className="min-w-0">

              {/* Image gallery (client component — handles lightbox + swipe) */}
              <ListingGallery images={detail.images} title={detail.title} />

              {/* ── Description ─────────────────────────────────────────── */}
              <section
                aria-labelledby="desc-heading"
                className="mt-8 bg-white rounded-2xl border border-[#E3E0D9] p-6"
              >
                <h2
                  id="desc-heading"
                  className="font-[family-name:var(--font-playfair)] text-[1.15rem]
                    font-semibold text-[#141414] mb-4"
                >
                  Description
                </h2>
                <div className="prose prose-sm max-w-none text-[#141414]">
                  {detail.description.split('\n').map((para, i) =>
                    para.trim() ? (
                      <p
                        key={i}
                        className="text-[13.5px] text-[#73706A] leading-relaxed mb-3 last:mb-0"
                      >
                        {para}
                      </p>
                    ) : (
                      <br key={i} />
                    )
                  )}
                </div>
              </section>

              {/* ── Item attributes ─────────────────────────────────────── */}
              {detail.attributes.length > 0 && (
                <section
                  aria-labelledby="attrs-heading"
                  className="mt-4 bg-white rounded-2xl border border-[#E3E0D9] p-6"
                >
                  <h2
                    id="attrs-heading"
                    className="font-[family-name:var(--font-playfair)] text-[1.15rem]
                      font-semibold text-[#141414] mb-4"
                  >
                    Item details
                  </h2>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {detail.attributes.map((attr) => (
                      <div
                        key={attr.label}
                        className="flex justify-between items-start py-2.5 px-3
                          rounded-xl bg-[#F8F7F4] border border-[#EFEDE8]"
                      >
                        <dt className="text-[12px] font-semibold text-[#9E9A91] uppercase tracking-wide">
                          {attr.label}
                        </dt>
                        <dd className="text-[13px] font-medium text-[#141414] text-right ml-4">
                          {attr.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {/* ── Safety banner ──────────────────────────────────────── */}
              <SafetyBanner />

              {/* ── Related listings ────────────────────────────────────── */}
              {relatedListings.length > 0 && (
                <section
                  aria-labelledby="related-heading"
                  className="mt-10"
                >
                  <h2
                    id="related-heading"
                    className="font-[family-name:var(--font-playfair)] text-[1.25rem]
                      font-semibold text-[#141414] mb-5"
                  >
                    More in {detail.categoryName}
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {relatedListings.map((l) => (
                      <ListingCard key={l.id} listing={l} />
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* ── Right column (sticky) ──────────────────────────────────── */}
            <div className="flex flex-col gap-4">
              {/* Price / action panel (client — handles offer modal, watchlist) */}
              <ListingActions listing={detail} />

              {/* Shipping estimate */}
              <ShippingEstimate sellerRegion={detail.region} />

              {/* Seller panel */}
              <SellerPanel seller={detail.seller} listingId={detail.id} />

              {/* Meta info */}
              <div
                className="bg-white rounded-2xl border border-[#E3E0D9] p-4
                  text-[12px] text-[#9E9A91] space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span>Listed</span>
                  <span className="font-medium text-[#141414]">
                    {new Date(detail.createdAt).toLocaleDateString('en-NZ', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Views</span>
                  <span className="font-medium text-[#141414]">
                    {detail.viewCount.toLocaleString('en-NZ')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Watchers</span>
                  <span className="font-medium text-[#141414]">
                    {detail.watcherCount.toLocaleString('en-NZ')}
                  </span>
                </div>
                {detail.offerCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Offers received</span>
                    <span className="font-medium text-[#141414]">{detail.offerCount}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span>Listing ID</span>
                  <span className="font-mono text-[11px] text-[#141414]">{detail.id}</span>
                </div>
              </div>

              {/* Report link */}
              <a
                href={`/report?listing=${detail.id}`}
                className="block text-[11.5px] text-[#C9C5BC] hover:text-red-500
                  transition-colors text-center"
              >
                Report this listing
              </a>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}

