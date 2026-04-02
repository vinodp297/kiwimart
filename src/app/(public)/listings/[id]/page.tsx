// src/app/(public)/listings/[id]/page.tsx
// ─── Listing Detail Page ──────────────────────────────────────────────────────

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import ListingCard from "@/components/ListingCard";
import { Breadcrumb } from "@/components/ui/primitives";
import { formatPrice, CONDITION_LABELS, relativeTime } from "@/lib/utils";
import ListingGallery from "./ListingGallery";
import ListingActions from "./ListingActions";
import { getConfigInt, CONFIG_KEYS } from "@/lib/platform-config";
import SellerPanel from "./SellerPanel";
import ShippingEstimate from "./ShippingEstimate";
import { getListingById } from "@/server/actions/listings";
import { searchListings } from "@/server/actions/search";
import { getSellerResponseTime } from "@/modules/listings/seller-response.service";
import { getSellerTrustProfile } from "@/modules/sellers/trust-score.service";
import { getListingSocialProof } from "@/modules/listings/social-proof.service";
import { getListingPriceHistory } from "@/modules/listings/price-history.service";
import {
  getMoreFromSeller,
  getSimilarListings,
} from "@/modules/listings/recommendations.service";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import SafetyBanner from "@/components/SafetyBanner";
import PriceHistoryChart from "@/components/PriceHistoryChart";
import RecordView from "@/components/RecordView";
import RecentlyViewed from "@/components/RecentlyViewed";
import { recordListingView } from "@/server/actions/recentlyViewed";
import type {
  ListingDetail,
  SellerPublic,
  ListingImage,
  ListingAttribute,
  Condition,
  NZRegion,
  SellerBadge,
} from "@/types";
import { getImageUrl as r2Url } from "@/lib/image";

export const revalidate = 60;

function mapCondition(c: string): Condition {
  const map: Record<string, Condition> = {
    NEW: "new",
    LIKE_NEW: "like-new",
    GOOD: "good",
    FAIR: "fair",
    PARTS: "parts",
  };
  return map[c] ?? "good";
}

// ── Metadata ──────────────────────────────────────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListingById(id);
  if (!listing) return { title: "Listing not found" };

  const price = listing.priceNzd / 100;
  const condition = mapCondition(listing.condition);
  const thumb = listing.images[0]?.r2Key
    ? r2Url(listing.images[0].r2Key)
    : undefined;

  return {
    title: listing.title,
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

  const images: ListingImage[] =
    listing.images.length > 0
      ? listing.images.map((img) => ({
          id: img.id,
          url: r2Url(img.r2Key),
          altText: listing.title,
          order: img.order,
        }))
      : [
          {
            id: `${id}-img0`,
            url: r2Url(null),
            altText: listing.title,
            order: 0,
          },
        ];

  const attributes: ListingAttribute[] = listing.attrs.map((a) => ({
    label: a.label,
    value: a.value,
  }));
  // Always include condition + category in attributes if not already present
  if (!attributes.find((a) => a.label === "Condition")) {
    attributes.unshift({
      label: "Condition",
      value: CONDITION_LABELS[condition],
    });
  }

  const session = await auth().catch(() => null);

  // Record view for authenticated users (fire-and-forget, never blocks render)
  // Skip if seller is viewing their own listing
  if (session?.user?.id && session.user.id !== listing.seller.id) {
    recordListingView(listing.id).catch(() => {});
  }

  // Fetch seller business status for badge display
  const sellerBusinessInfo = await db.user
    .findUnique({
      where: { id: listing.seller.id },
      select: { nzbn: true, gstRegistered: true },
    })
    .catch(() => null);

  const [responseTimeLabel, trustProfile, rawSocialProof, priceHistory] =
    await Promise.all([
      getSellerResponseTime(listing.seller.id).then(
        (r) => r ?? "Response time unknown",
      ),
      getSellerTrustProfile(listing.seller.id).catch(() => null),
      getListingSocialProof(listing.id).catch(() => ({
        viewCount: 0,
        watcherCount: 0,
        pendingOfferCount: 0,
      })),
      getListingPriceHistory(listing.id).catch(() => []),
    ]);

  // Check if current viewer is watching this listing
  let isWatching: { id: string } | null = null;
  let adjustedWatcherCount = rawSocialProof.watcherCount;
  if (session?.user?.id) {
    isWatching = await db.watchlistItem
      .findFirst({
        where: { userId: session.user.id, listingId: listing.id },
        select: { id: true },
      })
      .catch(() => null);
    if (isWatching)
      adjustedWatcherCount = Math.max(0, adjustedWatcherCount - 1);
  }
  const socialProof = { ...rawSocialProof, watcherCount: adjustedWatcherCount };

  const seller: SellerPublic = {
    id: listing.seller.id,
    username: listing.seller.username,
    displayName: listing.seller.displayName,
    avatarUrl: listing.seller.avatarKey
      ? r2Url(listing.seller.avatarKey)
      : null,
    bio: listing.seller.bio,
    region: (listing.seller.region ?? listing.region) as NZRegion,
    suburb: listing.seller.suburb ?? listing.suburb,
    rating:
      listing.seller.reviews.length > 0
        ? listing.seller.reviews.reduce(
            (sum: number, r: { rating: number }) => sum + r.rating,
            0,
          ) /
          listing.seller.reviews.length /
          10
        : 0,
    reviewCount: listing.seller._count.reviews,
    verified: false,
    memberSince: listing.seller.createdAt.toISOString(),
    activeListingCount: listing.seller._count.listings,
    soldCount: listing.seller._count.sellerOrders,
    responseTimeLabel,
    badges: [
      ...(listing.seller.idVerified ? ["verified_id" as SellerBadge] : []),
      ...(sellerBusinessInfo?.nzbn ? ["nz_business" as SellerBadge] : []),
    ],
  };

  const detail: ListingDetail = {
    id: listing.id,
    title: listing.title,
    price,
    condition,
    categoryName: listing.categoryId,
    subcategoryName: listing.subcategoryName ?? "",
    region: listing.region as NZRegion,
    suburb: listing.suburb,
    thumbnailUrl: images[0]?.url ?? "",
    sellerName: listing.seller.displayName,
    sellerUsername: listing.seller.username,
    sellerRating: seller.rating,
    sellerVerified: listing.seller.idVerified,
    viewCount: listing.viewCount,
    watcherCount: listing.watcherCount,
    createdAt: listing.createdAt.toISOString(),
    status: listing.status.toLowerCase() as ListingDetail["status"],
    shippingOption:
      listing.shippingOption.toLowerCase() as ListingDetail["shippingOption"],
    shippingPrice:
      listing.shippingNzd != null ? listing.shippingNzd / 100 : null,
    offersEnabled: listing.offersEnabled,
    description: listing.description ?? "No description provided.",
    images,
    attributes,
    seller,
    relatedListings: [],
    offerCount: rawSocialProof.pendingOfferCount,
    gstIncluded: listing.gstIncluded,
    pickupAddress: listing.pickupAddress,
  };

  // Fetch recommendations + related listings
  let relatedListings = detail.relatedListings;
  let moreFromSeller: typeof relatedListings = [];
  let similarListings: typeof relatedListings = [];
  try {
    const [related, fromSeller, similar] = await Promise.all([
      searchListings({
        category: listing.categoryId,
        pageSize: 5,
        sort: "most-watched",
      }),
      getMoreFromSeller(listing.seller.id, listing.id).catch(() => []),
      getSimilarListings(
        listing.id,
        listing.categoryId,
        listing.priceNzd,
        listing.seller.id,
      ).catch(() => []),
    ]);
    relatedListings = related.listings.filter((l) => l.id !== id).slice(0, 4);
    moreFromSeller = fromSeller;
    similarListings = similar.filter((l) => l.id !== id).slice(0, 4);
  } catch {
    // Fallback to empty
  }

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Browse", href: "/search" },
    {
      label: detail.categoryName,
      href: `/search?category=${detail.categoryName
        .toLowerCase()
        .replace(/\s+&\s+|-/g, "-")
        .replace(/\s+/g, "-")}`,
    },
    {
      label:
        detail.title.length > 40
          ? detail.title.slice(0, 40) + "…"
          : detail.title,
    },
  ];

  // JSON-LD structured data for Google rich results
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description ?? listing.title,
    image: images[0]?.url,
    offers: {
      "@type": "Offer",
      price: price.toFixed(2),
      priceCurrency: "NZD",
      availability:
        listing.status === "ACTIVE"
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      seller: {
        "@type": "Person",
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

      {/* Record this listing as recently viewed (client-side localStorage) */}
      <RecordView
        id={detail.id}
        title={detail.title}
        price={price}
        thumbnailUrl={images[0]?.url ?? ""}
        condition={condition}
      />

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

              {/* Social proof bar */}
              {(socialProof.viewCount > 0 ||
                socialProof.watcherCount > 0 ||
                socialProof.pendingOfferCount > 0) && (
                <div className="mt-3 flex items-center gap-4 text-[12px] text-[#73706A]">
                  {socialProof.viewCount > 0 && (
                    <span className="flex items-center gap-1">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      {socialProof.viewCount.toLocaleString("en-NZ")} views
                    </span>
                  )}
                  {socialProof.watcherCount > 0 && (
                    <span className="flex items-center gap-1">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      {socialProof.watcherCount} watching
                    </span>
                  )}
                  {socialProof.pendingOfferCount > 0 && (
                    <span className="flex items-center gap-1 text-amber-600 font-medium">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                      {socialProof.pendingOfferCount} pending{" "}
                      {socialProof.pendingOfferCount === 1 ? "offer" : "offers"}
                    </span>
                  )}
                  {socialProof.watcherCount >= 5 && (
                    <span className="text-orange-500 font-semibold">
                      Popular
                    </span>
                  )}
                </div>
              )}

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
                  {detail.description.split("\n").map((para, i) =>
                    para.trim() ? (
                      <p
                        key={i}
                        className="text-[13.5px] text-[#73706A] leading-relaxed mb-3 last:mb-0"
                      >
                        {para}
                      </p>
                    ) : (
                      <br key={i} />
                    ),
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

              {/* ── Price history ────────────────────────────────────── */}
              <PriceHistoryChart
                history={priceHistory}
                currentPriceNzd={listing.priceNzd}
              />

              {/* ── Safety banner ──────────────────────────────────────── */}
              <SafetyBanner />

              {/* ── More from this seller ────────────────────────────── */}
              {moreFromSeller.length > 0 && (
                <section className="mt-10">
                  <h2
                    className="font-[family-name:var(--font-playfair)] text-[1.25rem]
                      font-semibold text-[#141414] mb-5"
                  >
                    More from {detail.sellerName}
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {moreFromSeller.map((l) => (
                      <ListingCard key={l.id} listing={l} />
                    ))}
                  </div>
                </section>
              )}

              {/* ── Similar listings ──────────────────────────────────── */}
              {similarListings.length > 0 && (
                <section className="mt-10">
                  <h2
                    className="font-[family-name:var(--font-playfair)] text-[1.25rem]
                      font-semibold text-[#141414] mb-5"
                  >
                    Similar listings
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {similarListings.map((l) => (
                      <ListingCard key={l.id} listing={l} />
                    ))}
                  </div>
                </section>
              )}

              {/* ── Related listings ────────────────────────────────────── */}
              {relatedListings.length > 0 && (
                <section aria-labelledby="related-heading" className="mt-10">
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
              <ListingActions
                listing={detail}
                initialWatched={!!isWatching}
                offerMinPercentage={await getConfigInt(
                  CONFIG_KEYS.OFFER_MIN_PERCENTAGE,
                )}
              />

              {/* Shipping estimate */}
              <ShippingEstimate sellerRegion={detail.region} />

              {/* Seller panel */}
              <SellerPanel
                seller={detail.seller}
                listingId={detail.id}
                trustScore={trustProfile?.trustScore}
                tier={trustProfile?.tier}
              />

              {/* Meta info */}
              <div
                className="bg-white rounded-2xl border border-[#E3E0D9] p-4
                  text-[12px] text-[#9E9A91] space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span>Listed</span>
                  <span className="font-medium text-[#141414]">
                    {new Date(detail.createdAt).toLocaleDateString("en-NZ", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Views</span>
                  <span className="font-medium text-[#141414]">
                    {detail.viewCount.toLocaleString("en-NZ")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Watchers</span>
                  <span className="font-medium text-[#141414]">
                    {detail.watcherCount.toLocaleString("en-NZ")}
                  </span>
                </div>
                {detail.offerCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Offers received</span>
                    <span className="font-medium text-[#141414]">
                      {detail.offerCount}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span>Listing ID</span>
                  <span className="font-mono text-[11px] text-[#141414]">
                    {detail.id}
                  </span>
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
          {/* Recently viewed listings */}
          <RecentlyViewed excludeId={detail.id} maxItems={4} />
        </div>
      </main>

      <Footer />
    </>
  );
}
