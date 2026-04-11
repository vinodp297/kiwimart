// src/server/jobs/releaseStaleReservations.ts
// ─── Stale Listing Reservation Cron (Fix 10) ────────────────────────────────
// Releases listings that were RESERVED for an in-flight checkout when the
// 10-minute reservedUntil deadline lapsed. Without this, an abandoned
// checkout would leave the listing stuck in RESERVED forever and other
// buyers could not purchase it.
//
// Called by Vercel Cron via /api/cron/release-stale-reservations.
// Idempotent: a no-op when nothing has expired.

import { listingRepository } from "@/modules/listings/listing.repository";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";

export async function releaseStaleReservations(): Promise<{
  released: number;
  skipped?: boolean;
}> {
  const LOCK_KEY = "cron:release-stale-reservations";
  const LOCK_TTL_SECONDS = 120;

  const lock = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!lock) {
    logger.info("release_stale_reservations.skipped_lock_held", {
      reason:
        "Another instance is already running — skipping to prevent duplicate processing.",
    });
    return { released: 0, skipped: true };
  }

  try {
    return await runWithRequestContext(
      { correlationId: `cron:releaseStaleReservations:${Date.now()}` },
      async () => {
        const result = await listingRepository.releaseStaleReservations(
          new Date(),
        );
        logger.info("release_stale_reservations.completed", {
          released: result.count,
        });
        return { released: result.count };
      },
    );
  } finally {
    await releaseLock(LOCK_KEY, lock);
  }
}
