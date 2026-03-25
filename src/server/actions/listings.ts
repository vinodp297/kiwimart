'use server';
// src/server/actions/listings.ts
// ─── Listing Server Actions ───────────────────────────────────────────────────

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import db from '@/lib/db';
import { rateLimit, getClientIp } from '@/server/lib/rateLimit';
import { audit } from '@/server/lib/audit';
import { requireUser } from '@/server/lib/requireUser';
import { listingService } from '@/modules/listings/listing.service';
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

  // 1. Authenticate + ban check (fresh DB lookup every call)
  let authedUser;
  try {
    authedUser = await requireUser();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Authentication required.' };
  }

  // 2. Authorise — check email is verified and stripe onboarded
  const userDetails = await db.user.findUnique({
    where: { id: authedUser.id },
    select: { emailVerified: true, sellerEnabled: true },
  });
  if (!userDetails?.emailVerified) {
    return {
      success: false,
      error: 'Please verify your email address before creating a listing.',
    };
  }
  if (!authedUser.stripeOnboarded) {
    return {
      success: false,
      error: 'Please set up your payment account before listing items.',
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
  const limit = await rateLimit('listing', authedUser.id);
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
        sellerId: authedUser.id,
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
        isUrgent: data.isUrgent,
        isNegotiable: data.isNegotiable,
        shipsNationwide: data.shipsNationwide,
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
    if (!userDetails.sellerEnabled) {
      await tx.user.update({
        where: { id: authedUser.id },
        data: { sellerEnabled: true },
      });
    }

    return created;
  });

  // 6. Audit (fire-and-forget)
  audit({
    userId: authedUser.id,
    action: 'LISTING_CREATED',
    entityType: 'Listing',
    entityId: listing.id,
    metadata: { title: data.title, price: data.price },
    ip,
  });

  // 7. Revalidate affected cache paths
  revalidatePath('/');
  revalidatePath('/search');

  return {
    success: true,
    data: { listingId: listing.id, slug: listing.id },
  };
}

// ── updateListing ─────────────────────────────────────────────────────────────
// Updates a listing. If the price decreases, records previousPriceNzd and
// priceDroppedAt for the Price Dropped badge in ListingCard.

export async function updateListing(
  raw: unknown
): Promise<ActionResult<{ listingId: string }>> {
  const user = await requireUser();
  const parsed = updateListingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Validation failed.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const data = parsed.data;
  const { listingId } = data;

  // Load current listing to check ownership + existing price
  const existing = await db.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true, priceNzd: true, deletedAt: true },
  });

  if (!existing || existing.deletedAt) {
    return { success: false, error: 'Listing not found.' };
  }
  if (existing.sellerId !== user.id && !user.isAdmin) {
    return { success: false, error: 'Not authorised.' };
  }

  const newPriceNzd = data.price != null ? Math.round(data.price * 100) : undefined;
  const priceDropData =
    newPriceNzd != null && newPriceNzd < existing.priceNzd
      ? {
          previousPriceNzd: existing.priceNzd,
          priceDroppedAt: new Date(),
        }
      : {};

  await db.listing.update({
    where: { id: listingId },
    data: {
      ...(data.title != null ? { title: data.title } : {}),
      ...(data.description != null ? { description: data.description } : {}),
      ...(newPriceNzd != null ? { priceNzd: newPriceNzd } : {}),
      ...(data.gstIncluded != null ? { gstIncluded: data.gstIncluded } : {}),
      ...(data.condition != null ? { condition: data.condition } : {}),
      ...(data.categoryId != null ? { categoryId: data.categoryId } : {}),
      ...(data.subcategoryName !== undefined ? { subcategoryName: data.subcategoryName ?? null } : {}),
      ...(data.region != null ? { region: data.region } : {}),
      ...(data.suburb != null ? { suburb: data.suburb } : {}),
      ...(data.shippingOption != null ? { shippingOption: data.shippingOption } : {}),
      ...(data.shippingPrice != null ? { shippingNzd: Math.round(data.shippingPrice * 100) } : {}),
      ...(data.pickupAddress !== undefined ? { pickupAddress: data.pickupAddress ?? null } : {}),
      ...(data.offersEnabled != null ? { offersEnabled: data.offersEnabled } : {}),
      ...(data.isUrgent != null ? { isUrgent: data.isUrgent } : {}),
      ...(data.isNegotiable != null ? { isNegotiable: data.isNegotiable } : {}),
      ...(data.shipsNationwide != null ? { shipsNationwide: data.shipsNationwide } : {}),
      ...priceDropData,
    },
  });

  revalidatePath(`/listings/${listingId}`);
  revalidatePath('/dashboard/seller');
  revalidatePath('/search');

  return { success: true, data: { listingId } };
}

// ── deleteListing ─────────────────────────────────────────────────────────────

export async function deleteListing(
  listingId: string
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    await listingService.deleteListing(listingId, user.id, user.isAdmin);
    revalidatePath('/dashboard/seller');
    revalidatePath('/search');
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

// ── toggleWatch ───────────────────────────────────────────────────────────────

export async function toggleWatch(
  raw: unknown
): Promise<ActionResult<{ watching: boolean }>> {
  try {
    const user = await requireUser();
    const parsed = toggleWatchSchema.safeParse(raw);
    if (!parsed.success) {
      return { success: false, error: 'Invalid listing ID.' };
    }
    const result = await listingService.toggleWatch(parsed.data.listingId, user.id);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

// ── getListingById ────────────────────────────────────────────────────────────
// Public server function — delegated to ListingService

export async function getListingById(id: string) {
  return listingService.getListingById(id);
}

