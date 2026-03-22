'use server';
// src/server/actions/listings.ts
// ─── Listing Server Actions ───────────────────────────────────────────────────

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { rateLimit, getClientIp } from '@/server/lib/rateLimit';
import { audit } from '@/server/lib/audit';
import {
  createListingSchema,
  updateListingSchema,
  toggleWatchSchema,
} from '@/server/validators';
import type { ActionResult, ListingCard } from '@/types';

// ── createListing ─────────────────────────────────────────────────────────────

export async function createListing(
  raw: unknown
): Promise<ActionResult<{ listingId: string; slug: string }>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'You must be signed in to create a listing.' };
  }

  // 2. Authorise — check account is not banned and email is verified
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { isBanned: true, emailVerified: true, sellerEnabled: true },
  });
  if (!user || user.isBanned) {
    return { success: false, error: 'Your account is not permitted to create listings.' };
  }
  if (!user.emailVerified) {
    return {
      success: false,
      error: 'Please verify your email address before creating a listing.',
    };
  }

  // 3. Validate
  const parsed = createListingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid listing data',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // 4. Rate limit — 10 listings per hour per user
  const limit = await rateLimit('listing', session.user.id);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many listings created. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // 5a. Validate category exists
  const category = await db.category.findUnique({
    where: { id: data.categoryId },
    select: { id: true },
  });
  if (!category) {
    return { success: false, error: 'Invalid category.', fieldErrors: { categoryId: ['Invalid category'] } };
  }

  // 5b. Validate image keys exist and are safe (scanned by ClamAV in image upload action)
  const images = await db.listingImage.findMany({
    where: {
      r2Key: { in: data.imageKeys },
      scanned: true,
      safe: true,
    },
    select: { id: true, r2Key: true },
  });
  if (images.length !== data.imageKeys.length) {
    return {
      success: false,
      error: 'One or more images are invalid or have not passed safety checks.',
    };
  }

  // 5c. Create listing in a transaction
  const listing = await db.$transaction(async (tx) => {
    const created = await tx.listing.create({
      data: {
        sellerId: session.user.id,
        title: data.title,
        description: data.description,
        priceNzd: Math.round(data.price * 100), // Convert dollars → cents
        gstIncluded: data.gstIncluded,
        condition: data.condition,
        status: 'ACTIVE',
        categoryId: data.categoryId,
        subcategoryName: data.subcategoryName ?? null,
        region: data.region,
        suburb: data.suburb,
        shippingOption: data.shippingOption,
        shippingNzd: data.shippingPrice != null
          ? Math.round(data.shippingPrice * 100)
          : null,
        pickupAddress: data.pickupAddress ?? null,
        offersEnabled: data.offersEnabled,
        publishedAt: new Date(),
        // Expire after 30 days
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        images: {
          create: data.imageKeys.map((key, i) => ({
            r2Key: key,
            order: i,
          })),
        },
        attrs: {
          create: data.attributes.map((attr, i) => ({
            label: attr.label,
            value: attr.value,
            order: i,
          })),
        },
      },
      select: { id: true },
    });

    // Enable seller if this is their first listing
    if (!user.sellerEnabled) {
      await tx.user.update({
        where: { id: session.user.id },
        data: { sellerEnabled: true },
      });
    }

    return created;
  });

  // 6. Audit (fire-and-forget)
  audit({
    userId: session.user.id,
    action: 'LISTING_CREATED',
    entityType: 'Listing',
    entityId: listing.id,
    metadata: { title: data.title, price: data.price },
    ip,
  });

  // 7. Revalidate affected cache paths
  revalidatePath('/');
  revalidatePath('/search');
  revalidatePath(`/sellers/${session.user.username}`);

  return {
    success: true,
    data: { listingId: listing.id, slug: listing.id },
  };
}

// ── deleteListing ─────────────────────────────────────────────────────────────

export async function deleteListing(
  listingId: string
): Promise<ActionResult<void>> {
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  // 3. Validate
  if (!listingId || typeof listingId !== 'string') {
    return { success: false, error: 'Invalid listing ID.' };
  }

  // 2. Authorise — must own the listing (admins can also delete)
  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: { id: true, sellerId: true, status: true, title: true },
  });
  if (!listing) {
    return { success: false, error: 'Listing not found.' };
  }
  if (listing.sellerId !== session.user.id && !session.user.isAdmin) {
    return { success: false, error: 'You do not have permission to delete this listing.' };
  }
  if (listing.status === 'SOLD') {
    return { success: false, error: 'Sold listings cannot be deleted.' };
  }

  // 5. Soft delete
  await db.listing.update({
    where: { id: listingId },
    data: { deletedAt: new Date(), status: 'REMOVED' },
  });

  // 6. Audit
  audit({
    userId: session.user.id,
    action: 'LISTING_DELETED',
    entityType: 'Listing',
    entityId: listingId,
    metadata: { title: listing.title },
  });

  // 7. Revalidate
  revalidatePath('/dashboard/seller');
  revalidatePath('/search');

  return { success: true, data: undefined };
}

// ── toggleWatch ───────────────────────────────────────────────────────────────

export async function toggleWatch(
  raw: unknown
): Promise<ActionResult<{ watching: boolean }>> {
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Sign in to save listings to your watchlist.' };
  }

  // 3. Validate
  const parsed = toggleWatchSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: 'Invalid listing ID.' };
  }
  const { listingId } = parsed.data;

  // 5. Toggle watchlist
  const existing = await db.watchlistItem.findUnique({
    where: {
      userId_listingId: { userId: session.user.id, listingId },
    },
  });

  if (existing) {
    // Unwatch
    await db.$transaction([
      db.watchlistItem.delete({
        where: { userId_listingId: { userId: session.user.id, listingId } },
      }),
      db.listing.update({
        where: { id: listingId },
        data: { watcherCount: { decrement: 1 } },
      }),
    ]);
    return { success: true, data: { watching: false } };
  } else {
    // Watch — verify listing exists first
    const listing = await db.listing.findUnique({
      where: { id: listingId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!listing) return { success: false, error: 'Listing not available.' };

    await db.$transaction([
      db.watchlistItem.create({
        data: { userId: session.user.id, listingId },
      }),
      db.listing.update({
        where: { id: listingId },
        data: { watcherCount: { increment: 1 } },
      }),
    ]);
    return { success: true, data: { watching: true } };
  }
}

// ── getListingById ────────────────────────────────────────────────────────────
// Public server function — used in listing detail page (not a server action)

export async function getListingById(id: string) {
  const listing = await db.listing.findUnique({
    where: {
      id,
      status: { in: ['ACTIVE', 'RESERVED', 'SOLD'] },
      deletedAt: null,
    },
    include: {
      seller: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarKey: true,
          bio: true,
          region: true,
          suburb: true,
          idVerified: true,
          createdAt: true,
          _count: {
            select: {
              sellerOrders: { where: { status: 'COMPLETED' } },
              listings: { where: { status: 'ACTIVE' } },
            },
          },
        },
      },
      images: { orderBy: { order: 'asc' } },
      attrs: { orderBy: { order: 'asc' } },
    },
  });

  if (!listing) return null;

  // Increment view count (fire-and-forget — don't await)
  db.listing
    .update({ where: { id }, data: { viewCount: { increment: 1 } } })
    .catch(() => {});

  return listing;
}

