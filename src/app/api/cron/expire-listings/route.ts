// src/app/api/cron/expire-listings/route.ts
// ─── Vercel Cron — Expire Listings + Release Offer Reservations ───────────────
// Runs daily at 3:00 AM UTC (schedule: "0 3 * * *" in vercel.json).
// 1 hour after auto-release to avoid DB contention.

import { NextResponse } from "next/server";
import {
  expireListings,
  releaseExpiredOfferReservations,
} from "@/server/jobs/expireListings";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  try {
    logger.info("cron.expire_listings.triggered");

    const [listingResult, offerResult] = await Promise.all([
      expireListings(),
      releaseExpiredOfferReservations(),
    ]);

    return NextResponse.json({
      success: true,
      listings: listingResult,
      offers: offerResult,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/cron/expire-listings",
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      { error: "Listing expiration job failed." },
      { status: 500 },
    );
  }
}
