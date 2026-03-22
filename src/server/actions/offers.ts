'use server';
// src/server/actions/offers.ts
// ─── Offer Server Actions ─────────────────────────────────────────────────────

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { rateLimit, getClientIp } from '@/server/lib/rateLimit';
import { audit } from '@/server/lib/audit';
import { createOfferSchema, respondOfferSchema } from '@/server/validators';
import type { ActionResult } from '@/types';

// ── createOffer ───────────────────────────────────────────────────────────────

export async function createOffer(
  raw: unknown
): Promise<ActionResult<{ offerId: string }>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Sign in to make an offer.' };
  }

  // 3. Validate
  const parsed = createOfferSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid offer',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { listingId, amount, note } = parsed.data;

  // 4. Rate limit
  const limit = await rateLimit('offer', session.user.id);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many offers. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // 5a. Load listing with ownership check
  const listing = await db.listing.findUnique({
    where: { id: listingId, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      sellerId: true,
      title: true,
      priceNzd: true,
      offersEnabled: true,
      seller: { select: { email: true, displayName: true } },
    },
  });

  if (!listing) return { success: false, error: 'Listing not available.' };
  if (!listing.offersEnabled) {
    return { success: false, error: 'This seller is not accepting offers.' };
  }
  if (listing.sellerId === session.user.id) {
    return { success: false, error: 'You cannot make an offer on your own listing.' };
  }

  // 5b. Validate offer amount (50%–99% of asking price)
  const amountCents = Math.round(amount * 100);
  if (amountCents >= listing.priceNzd) {
    return {
      success: false,
      error: 'Your offer must be less than the asking price. Use "Buy Now" instead.',
    };
  }
  if (amountCents < listing.priceNzd * 0.5) {
    return {
      success: false,
      error: 'Offers below 50% of the asking price are not accepted.',
    };
  }

  // 5c. Check for existing pending offer from this buyer
  const existingOffer = await db.offer.findFirst({
    where: {
      listingId,
      buyerId: session.user.id,
      status: 'PENDING',
    },
  });
  if (existingOffer) {
    return {
      success: false,
      error: 'You already have a pending offer on this listing. Withdraw it to make a new one.',
    };
  }

  // 5d. Create offer
  const offer = await db.offer.create({
    data: {
      listingId,
      buyerId: session.user.id,
      sellerId: listing.sellerId,
      amountNzd: amountCents,
      note: note ?? null,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
    },
    select: { id: true },
  });

  // 5e. Notify seller (fire-and-forget)
  const buyer = await db.user.findUnique({
    where: { id: session.user.id },
    select: { displayName: true },
  });
  try {
    const { emailQueue } = await import('@/lib/queue');
    await emailQueue.add('offerReceived', {
      type: 'offerReceived' as const,
      payload: {
        to: listing.seller.email,
        sellerName: listing.seller.displayName,
        buyerName: buyer?.displayName ?? 'A buyer',
        listingTitle: listing.title,
        offerAmount: amount,
        listingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/listings/${listingId}`,
      },
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
  } catch {
    const { sendOfferReceivedEmail } = await import('@/server/email');
    sendOfferReceivedEmail({
      to: listing.seller.email, sellerName: listing.seller.displayName,
      buyerName: buyer?.displayName ?? 'A buyer', listingTitle: listing.title,
      offerAmount: amount, listingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/listings/${listingId}`,
    }).catch(() => {});
  }

  // 6. Audit
  audit({
    userId: session.user.id,
    action: 'OFFER_CREATED',
    entityType: 'Offer',
    entityId: offer.id,
    metadata: { listingId, amountNzd: amountCents },
    ip,
  });

  revalidatePath(`/listings/${listingId}`);

  return { success: true, data: { offerId: offer.id } };
}

// ── respondOffer ──────────────────────────────────────────────────────────────

export async function respondOffer(
  raw: unknown
): Promise<ActionResult<void>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  // 3. Validate
  const parsed = respondOfferSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: 'Invalid input' };
  }
  const { offerId, action, declineNote } = parsed.data;

  // 5a. Load offer
  const offer = await db.offer.findUnique({
    where: { id: offerId },
    include: {
      buyer: { select: { email: true, displayName: true } },
      listing: { select: { id: true, title: true } },
    },
  });

  if (!offer) return { success: false, error: 'Offer not found.' };

  // 2. Authorise — only the seller can respond
  if (offer.sellerId !== session.user.id) {
    return { success: false, error: 'You do not have permission to respond to this offer.' };
  }
  if (offer.status !== 'PENDING') {
    return { success: false, error: 'This offer has already been responded to.' };
  }
  if (offer.expiresAt < new Date()) {
    return { success: false, error: 'This offer has expired.' };
  }

  // 5b. Update offer status
  const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
  await db.offer.update({
    where: { id: offerId },
    data: {
      status: newStatus,
      respondedAt: new Date(),
      declineNote: declineNote ?? null,
    },
  });

  // 5c. If accepted, reserve the listing
  if (action === 'ACCEPT') {
    await db.listing.update({
      where: { id: offer.listingId },
      data: { status: 'RESERVED' },
    });
    // Decline all other pending offers on this listing
    await db.offer.updateMany({
      where: {
        listingId: offer.listingId,
        id: { not: offerId },
        status: 'PENDING',
      },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
  }

  // 5d. Notify buyer via email queue
  try {
    const { emailQueue } = await import('@/lib/queue');
    await emailQueue.add('offerResponse', {
      type: 'offerResponse' as const,
      payload: {
        to: offer.buyer.email, buyerName: offer.buyer.displayName,
        listingTitle: offer.listing.title, accepted: action === 'ACCEPT',
        listingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/listings/${offer.listingId}`,
      },
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
  } catch {
    const { sendOfferResponseEmail } = await import('@/server/email');
    sendOfferResponseEmail({
      to: offer.buyer.email, buyerName: offer.buyer.displayName,
      listingTitle: offer.listing.title, accepted: action === 'ACCEPT',
      listingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/listings/${offer.listingId}`,
    }).catch(() => {});
  }

  // 6. Audit
  audit({
    userId: session.user.id,
    action: action === 'ACCEPT' ? 'OFFER_ACCEPTED' : 'OFFER_DECLINED',
    entityType: 'Offer',
    entityId: offerId,
    ip,
  });

  revalidatePath(`/listings/${offer.listingId}`);
  revalidatePath('/dashboard/seller');

  return { success: true, data: undefined };
}

