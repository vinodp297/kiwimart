// src/app/(public)/checkout/[listingId]/page.tsx
// ─── Checkout Page (Server Component) ───────────────────────────────────────
// Loads listing data server-side, passes to CheckoutForm client component.
// Redirects to login if not authenticated.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import CheckoutForm from './CheckoutForm';

function r2Url(key: string | null): string {
  if (!key) return 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=480&h=480&fit=crop';
  if (key.startsWith('http')) return key;
  return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${key}`;
}

export default async function CheckoutPage(props: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await props.params;

  // Auth check — redirect to login if not signed in
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?from=/checkout/${listingId}`);
  }

  // Load listing from DB
  const listing = await db.listing.findUnique({
    where: { id: listingId, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      title: true,
      priceNzd: true,
      shippingNzd: true,
      shippingOption: true,
      region: true,
      suburb: true,
      sellerId: true,
      condition: true,
      seller: {
        select: {
          displayName: true,
          username: true,
          stripeAccountId: true,
          stripeOnboarded: true,
        },
      },
      images: {
        where: { order: 0 },
        select: { r2Key: true },
        take: 1,
      },
    },
  });

  if (!listing) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414] mb-2">
              Listing not found
            </h1>
            <p className="text-[14px] text-[#9E9A91] mb-4">
              This listing may have been removed or sold.
            </p>
            <Link
              href="/search"
              className="text-[13px] font-semibold text-[#D4A843] hover:text-[#B8912E] transition-colors"
            >
              Browse listings →
            </Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  // Cannot buy own listing
  if (listing.sellerId === session.user.id) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414] mb-2">
              This is your listing
            </h1>
            <p className="text-[14px] text-[#9E9A91] mb-4">
              You cannot purchase your own listing.
            </p>
            <Link
              href={`/listings/${listing.id}`}
              className="text-[13px] font-semibold text-[#D4A843] hover:text-[#B8912E] transition-colors"
            >
              Back to listing →
            </Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const COND_MAP: Record<string, string> = {
    NEW: 'Brand New', LIKE_NEW: 'Like New', GOOD: 'Good', FAIR: 'Fair', PARTS: 'Parts Only',
  };

  const sellerHasStripe = listing.seller.stripeAccountId && listing.seller.stripeOnboarded;

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-[12.5px] text-[#9E9A91] mb-6">
            <Link href={`/listings/${listing.id}`} className="hover:text-[#D4A843] transition-colors">
              {listing.title}
            </Link>
            <span>/</span>
            <span className="text-[#141414] font-medium">Checkout</span>
          </nav>

          <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] mb-8">
            Complete your purchase
          </h1>

          {!sellerHasStripe ? (
            <div className="bg-white rounded-2xl border border-[#E3E0D9] p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2">
                Seller payment not set up yet
              </h2>
              <p className="text-[13.5px] text-[#73706A] max-w-md mx-auto mb-4">
                This seller hasn&apos;t completed their payment setup.
                Please message them or check back later.
              </p>
              <Link href={`/listings/${listing.id}`}>
                <button className="text-[13px] font-semibold text-[#D4A843] hover:text-[#B8912E] transition-colors">
                  Back to listing →
                </button>
              </Link>
            </div>
          ) : (
            <CheckoutForm
              listing={{
                id: listing.id,
                title: listing.title,
                priceNzd: listing.priceNzd,
                shippingNzd: listing.shippingOption === 'PICKUP' ? 0 : (listing.shippingNzd ?? 0),
                shippingOption: listing.shippingOption.toLowerCase() as 'pickup' | 'courier' | 'both',
                condition: COND_MAP[listing.condition] ?? 'Good',
                region: listing.region,
                suburb: listing.suburb,
                thumbnailUrl: r2Url(listing.images[0]?.r2Key ?? null),
                sellerName: listing.seller.displayName,
                sellerUsername: listing.seller.username,
              }}
            />
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
