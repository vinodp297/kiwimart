// src/app/(protected)/messages/new/page.tsx
// ─── New Message Page ─────────────────────────────────────────────────────────
// Lets a buyer start a conversation with a seller about a specific listing,
// OR send a direct message from the seller profile (no listingId).
// URL: /messages/new?listingId=xxx&sellerId=xxx   (listing-specific)
//      /messages/new?sellerId=xxx                  (direct from seller profile)

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { getImageUrl } from '@/lib/image';
import { NewMessageForm } from './NewMessageForm';

interface Props {
  searchParams: Promise<{ listingId?: string; sellerId?: string }>;
}

export default async function NewMessagePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login?from=/messages/new');
  }

  const { listingId, sellerId } = await searchParams;

  // sellerId is always required
  if (!sellerId) {
    redirect('/search');
  }

  // Cannot message yourself
  if (sellerId === session.user.id) {
    redirect(listingId ? `/listings/${listingId}` : '/search');
  }

  // ── Listing-specific mode (listingId provided) ────────────────────────────
  let listing: {
    id: string;
    title: string;
    priceNzd: number;
    status: string;
    seller: { id: string; displayName: string; username: string; avatarKey: string | null };
    images: { r2Key: string }[];
  } | null = null;

  if (listingId) {
    listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        priceNzd: true,
        status: true,
        seller: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarKey: true,
          },
        },
        images: {
          orderBy: { order: 'asc' },
          select: { r2Key: true },
          take: 1,
        },
      },
    });

    if (!listing) {
      redirect('/search');
    }

    // Verify sellerId matches the actual seller
    if (listing.seller.id !== sellerId) {
      redirect(`/listings/${listingId}`);
    }
  }

  // ── Direct-message mode (no listingId) ────────────────────────────────────
  let sellerInfo: { id: string; displayName: string; username: string; avatarKey: string | null } | null = null;

  if (!listingId) {
    sellerInfo = await db.user.findFirst({
      where: { id: sellerId, deletedAt: null, isBanned: false },
      select: { id: true, displayName: true, username: true, avatarKey: true },
    });

    if (!sellerInfo) {
      redirect('/search');
    }
  }

  const seller = listing?.seller ?? sellerInfo!;

  // Check if thread already exists (service sorts participant IDs)
  const [p1, p2] = [session.user.id, sellerId].sort();
  const existingThread = await db.messageThread.findFirst({
    where: {
      participant1Id: p1,
      participant2Id: p2,
      ...(listingId ? { listingId } : { listingId: null }),
    },
    select: { id: true },
  });

  // If a thread already exists, go straight to it in the dashboard
  if (existingThread) {
    redirect('/dashboard/buyer');
  }

  const thumbUrl = listingId && listing
    ? getImageUrl(listing.images[0]?.r2Key ?? null)
    : null;
  const sellerInitial = seller.displayName[0]?.toUpperCase() ?? '?';

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Back link */}
        <a
          href={listingId ? `/listings/${listingId}` : `/sellers/${seller.username}`}
          className="inline-flex items-center gap-1.5 text-[13px]
            text-[#73706A] hover:text-[#141414] transition-colors mb-6"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {listingId ? 'Back to listing' : 'Back to seller profile'}
        </a>

        {/* Page heading */}
        <h1 className="font-[family-name:var(--font-playfair)]
          text-2xl font-semibold text-[#141414] mb-6">
          Message seller
        </h1>

        {/* Listing preview card — only shown in listing-specific mode */}
        {listing && (
          <div className="bg-white border border-[#E3E0D9]
            rounded-xl p-4 mb-6 flex gap-4 items-center">
            <div className="w-16 h-16 bg-[#F2EFE8]
              rounded-lg flex-shrink-0 overflow-hidden">
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={listing.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center
                  text-[#9E9A91]">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[#141414] truncate text-[14px]">
                {listing.title}
              </p>
              <p className="text-[#D4A843] font-semibold text-[15px]">
                ${(listing.priceNzd / 100).toFixed(2)} NZD
              </p>
            </div>
          </div>
        )}

        {/* Seller info */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full
            bg-[#141414] flex items-center justify-center
            text-white font-semibold text-[14px] flex-shrink-0">
            {sellerInitial}
          </div>
          <div>
            <p className="text-[13px] text-[#73706A]">Sending to</p>
            <p className="font-medium text-[#141414] text-[14px]">
              {seller.displayName}
            </p>
          </div>
        </div>

        {/* Message compose form */}
        <NewMessageForm
          listingId={listingId ?? null}
          sellerId={sellerId}
          listingTitle={listing?.title ?? null}
        />

      </div>
    </div>
  );
}
