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
import { recordCronRun } from "@/server/lib/cronLogger";
import { runCronJob } from "@/lib/cron-monitor";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  try {
    logger.info("cron.expire_listings.triggered");

    const { listings, offers } = await runCronJob(
      "expireListings",
      async () => {
        const [listingResult, offerResult] = await Promise.all([
          expireListings(),
          releaseExpiredOfferReservations(),
        ]);
        return {
          processed: listingResult.expired,
          listings: listingResult,
          offers: offerResult,
        };
      },
    );

    await recordCronRun("expire-listings", "success", startedAt);
    return NextResponse.json({
      success: true,
      listings,
      offers,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordCronRun("expire-listings", "error", startedAt, msg);
    return NextResponse.json(
      { error: "Listing expiration job failed." },
      { status: 500 },
    );
  }
}
