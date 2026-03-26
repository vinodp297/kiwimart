// src/app/api/cron/expire-listings/route.ts
// ─── Vercel Cron — Expire Listings + Release Offer Reservations ───────────────
// Runs daily at 3:00 AM UTC (schedule: "0 3 * * *" in vercel.json).
// 1 hour after auto-release to avoid DB contention.

import { NextResponse } from 'next/server'
import { expireListings, releaseExpiredOfferReservations } from '@/server/jobs/expireListings'
import { logger } from '@/shared/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('cron.expire_listings.unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  logger.info('cron.expire_listings.triggered')

  const [listingResult, offerResult] = await Promise.all([
    expireListings(),
    releaseExpiredOfferReservations(),
  ])

  return NextResponse.json({
    success: true,
    listings: listingResult,
    offers: offerResult,
    timestamp: new Date().toISOString(),
  })
}
