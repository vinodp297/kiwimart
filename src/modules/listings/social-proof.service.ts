// src/modules/listings/social-proof.service.ts
// ─── Listing Social Proof — real data, cached 5 min ─────────────────────────

import db from '@/lib/db'
import { unstable_cache } from 'next/cache'

export interface SocialProofData {
  viewCount: number      // last 7 days (from listing.viewCount for now)
  watcherCount: number
  pendingOfferCount: number
}

async function fetchSocialProof(listingId: string): Promise<SocialProofData> {
  const [listing, pendingOffers] = await Promise.all([
    db.listing.findUnique({
      where: { id: listingId },
      select: {
        viewCount: true,
        _count: { select: { watchers: true } },
      },
    }),
    db.offer.count({
      where: { listingId, status: 'PENDING' },
    }),
  ])

  return {
    viewCount: listing?.viewCount ?? 0,
    watcherCount: listing?._count.watchers ?? 0,
    pendingOfferCount: pendingOffers,
  }
}

/**
 * Get social proof data for a listing. Cached 5 minutes.
 */
export const getListingSocialProof = unstable_cache(
  fetchSocialProof,
  ['listing-social-proof'],
  { revalidate: 300 }
)
