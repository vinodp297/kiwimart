// src/server/jobs/expireListings.ts
// ─── Listing Expiry + Offer Reservation Release Jobs ─────────────────────────
// Run daily via Vercel Cron at 3 AM UTC.

import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";
import { listingRepository } from "@/modules/listings/listing.repository";
import { offerRepository } from "@/modules/offers/offer.repository";
import { orderRepository } from "@/modules/orders/order.repository";
import { withTransaction } from "@/lib/transaction";

const LOCK_TTL_SECONDS = 300;

// ── expireListings ────────────────────────────────────────────────────────────

export async function expireListings(): Promise<{
  expired: number;
  errors: number;
  skipped?: boolean;
}> {
  const LOCK_KEY = "cron:expire-listings";
  const lock = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!lock) {
    logger.info("expire_listings.skipped_lock_held", {
      reason:
        "Another instance is already running — skipping to prevent duplicate processing.",
    });
    return { expired: 0, errors: 0, skipped: true };
  }

  try {
    return await runWithRequestContext(
      { correlationId: `cron:expireListings:${Date.now()}` },
      async () => {
        logger.info("job.expire_listings.started");

        const now = new Date();
        let expired = 0;
        let errors = 0;

        try {
          const result = await listingRepository.expireActivePast(now);

          expired = result.count;

          logger.info("job.expire_listings.completed", {
            expired,
            timestamp: now.toISOString(),
          });
        } catch (err) {
          errors++;
          logger.error("job.expire_listings.failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        return { expired, errors };
      }, // end runWithRequestContext fn
    ); // end runWithRequestContext
  } finally {
    await releaseLock(LOCK_KEY, lock);
  }
}

// ── releaseExpiredOfferReservations ───────────────────────────────────────────
// When a seller accepts an offer, the listing moves to RESERVED and
// paymentDeadlineAt is set 24 hours out. If the buyer hasn't paid by then,
// this job releases the listing back to ACTIVE and marks the offer EXPIRED.

export async function releaseExpiredOfferReservations(): Promise<{
  released: number;
  errors: number;
  skipped?: boolean;
}> {
  const LOCK_KEY = "cron:release-expired-offer-reservations";
  const lock = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!lock) {
    logger.info("release_expired_offer_reservations.skipped_lock_held", {
      reason:
        "Another instance is already running — skipping to prevent duplicate processing.",
    });
    return { released: 0, errors: 0, skipped: true };
  }

  try {
    return await runWithRequestContext(
      { correlationId: `cron:releaseExpiredOfferReservations:${Date.now()}` },
      async () => {
        logger.info("job.release_expired_offer_reservations.started");

        const now = new Date();
        let released = 0;
        let errors = 0;

        // Find accepted offers whose payment window has closed
        const expiredOffers =
          await offerRepository.findExpiredAcceptedOffers(now);

        if (expiredOffers.length === 0) {
          logger.info("job.release_expired_offer_reservations.completed", {
            released: 0,
          });
          return { released: 0, errors: 0 };
        }

        // Exclude listings that already have a paid order (buyer completed checkout)
        const paidListingIds = new Set(
          await orderRepository.findListingIdsWithActiveOrders(
            expiredOffers.map((o) => o.listingId),
          ),
        );

        const trulyExpired = expiredOffers.filter(
          (o) => !paidListingIds.has(o.listingId),
        );

        if (trulyExpired.length > 0) {
          try {
            const expiredOfferIds = trulyExpired.map((o) => o.id);
            const expiredListingIds = [
              ...new Set(trulyExpired.map((o) => o.listingId)),
            ];

            // Bulk update in a single transaction so that an offer is not
            // marked EXPIRED while its listing remains RESERVED (or vice versa).
            await withTransaction(async (tx) => {
              await offerRepository.expireAcceptedOffers(expiredOfferIds, tx);
              await listingRepository.bulkReleaseFromReserved(
                expiredListingIds,
                tx,
              );
            });

            released = trulyExpired.length;
            logger.info("job.release_expired_offers.bulk", {
              offersExpired: expiredOfferIds.length,
              listingsReleased: expiredListingIds.length,
            });
          } catch (err) {
            errors = trulyExpired.length;
            logger.error("job.release_expired_offers.bulk_failed", {
              count: trulyExpired.length,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        logger.info("job.release_expired_offer_reservations.completed", {
          released,
          errors,
        });

        return { released, errors };
      }, // end runWithRequestContext fn
    ); // end runWithRequestContext
  } finally {
    await releaseLock(LOCK_KEY, lock);
  }
}
