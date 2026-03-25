'use server';
// src/server/actions/offers.ts — thin wrapper
// Business logic delegated to OfferService.

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { rateLimit, getClientIp } from '@/server/lib/rateLimit';
import { requireUser } from '@/server/lib/requireUser';
import { offerService } from '@/modules/offers/offer.service';
import { createOfferSchema, respondOfferSchema } from '@/server/validators';
import type { ActionResult } from '@/types';

export async function createOffer(
  raw: unknown
): Promise<ActionResult<{ offerId: string }>> {
  try {
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);
    const user = await requireUser();

    const parsed = createOfferSchema.safeParse(raw);
    if (!parsed.success) {
      return { success: false, error: 'Invalid offer', fieldErrors: parsed.error.flatten().fieldErrors };
    }

    const limit = await rateLimit('offer', user.id);
    if (!limit.success) {
      return { success: false, error: `Too many offers. Try again in ${limit.retryAfter} seconds.` };
    }

    const result = await offerService.createOffer(parsed.data, user.id, ip);

    revalidatePath(`/listings/${parsed.data.listingId}`);

    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

export async function respondOffer(
  raw: unknown
): Promise<ActionResult<void>> {
  try {
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);
    const user = await requireUser();

    const parsed = respondOfferSchema.safeParse(raw);
    if (!parsed.success) return { success: false, error: 'Invalid input' };

    await offerService.respondOffer(parsed.data, user.id, ip);

    revalidatePath(`/dashboard/seller`);

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}
