// src/app/api/cron/expire-listings/route.ts
// ─── Vercel Cron — Expire Listings + Release Offer Reservations ───────────────
// Runs daily at 3:00 AM UTC (schedule: "0 3 * * *" in vercel.json).
// 1 hour after auto-release to avoid DB contention.
//
// Each job runs in isolation via Promise.allSettled so a failure in one
// does not prevent the other from executing.

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

const JOB_NAMES = [
  "expireListings",
  "releaseExpiredOfferReservations",
] as const;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  logger.info("cron.expire_listings.triggered");

  // Run both jobs independently — a failure in one must not skip the other.
  const [listingsResult, offersResult] = await Promise.allSettled([
    runCronJob("expireListings", expireListings),
    runCronJob(
      "releaseExpiredOfferReservations",
      releaseExpiredOfferReservations,
    ),
  ]);

  const allResults = [listingsResult, offersResult];

  const failed = allResults
    .map((r, i) => (r.status === "rejected" ? JOB_NAMES[i] : null))
    .filter((name): name is (typeof JOB_NAMES)[number] => name !== null);

  if (failed.length > 0) {
    logger.error("cron.expire_listings.partial_failure", { failed });
    await recordCronRun(
      "expire-listings",
      "error",
      startedAt,
      `Jobs failed: ${failed.join(", ")}`,
    );
  } else {
    await recordCronRun("expire-listings", "success", startedAt);
  }

  return NextResponse.json({
    success: failed.length === 0,
    timestamp: new Date().toISOString(),
    results: allResults.map((r, i) => ({
      job: JOB_NAMES[i],
      status: r.status,
      ...(r.status === "fulfilled"
        ? { data: r.value }
        : {
            error:
              r.reason instanceof Error ? r.reason.message : String(r.reason),
          }),
    })),
  });
}
