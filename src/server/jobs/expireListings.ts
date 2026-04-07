// src/server/jobs/expireListings.ts
// ─── Listing Expiry + Offer Reservation Release Jobs ─────────────────────────
// Run daily via Vercel Cron at 3 AM UTC.

import db from "@/lib/db";
import { logger } from "@/shared/logger";

// ── expireListings ────────────────────────────────────────────────────────────

export async function expireListings(): Promise<{
  expired: number;
  errors: number;
}> {
  logger.info("job.expire_listings.started");

  const now = new Date();
  let expired = 0;
  let errors = 0;

  try {
    const result = await db.listing.updateMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lt: now },
        deletedAt: null,
      },
      data: {
        status: "EXPIRED",
      },
    });

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
}

// ── releaseExpiredOfferReservations ───────────────────────────────────────────
// When a seller accepts an offer, the listing moves to RESERVED and
// paymentDeadlineAt is set 24 hours out. If the buyer hasn't paid by then,
// this job releases the listing back to ACTIVE and marks the offer EXPIRED.

export async function releaseExpiredOfferReservations(): Promise<{
  released: number;
  errors: number;
}> {
  logger.info("job.release_expired_offer_reservations.started");

  const now = new Date();
  let released = 0;
  let errors = 0;

  // Find accepted offers whose payment window has closed
  const expiredOffers = await db.offer.findMany({
    where: {
      status: "ACCEPTED",
      paymentDeadlineAt: { lt: now },
    },
    select: {
      id: true,
      listingId: true,
    },
  });

  if (expiredOffers.length === 0) {
    logger.info("job.release_expired_offer_reservations.completed", {
      released: 0,
    });
    return { released: 0, errors: 0 };
  }

  // Exclude listings that already have a paid order (buyer completed checkout)
  const paidListingIds = await db.order
    .findMany({
      where: {
        listingId: { in: expiredOffers.map((o) => o.listingId) },
        status: {
          in: [
            "PAYMENT_HELD",
            "DISPATCHED",
            "DELIVERED",
            "COMPLETED",
            "DISPUTED",
          ],
        },
      },
      select: { listingId: true },
    })
    .then((orders) => new Set(orders.map((o) => o.listingId)));

  const trulyExpired = expiredOffers.filter(
    (o) => !paidListingIds.has(o.listingId),
  );

  if (trulyExpired.length > 0) {
    try {
      const expiredOfferIds = trulyExpired.map((o) => o.id);
      const expiredListingIds = [
        ...new Set(trulyExpired.map((o) => o.listingId)),
      ];

      // Bulk update in a single transaction
      await db.$transaction([
        db.offer.updateMany({
          where: {
            id: { in: expiredOfferIds },
            status: "ACCEPTED", // safety check
          },
          data: { status: "EXPIRED", updatedAt: new Date() },
        }),
        db.listing.updateMany({
          where: {
            id: { in: expiredListingIds },
            status: "RESERVED", // only release if still reserved
          },
          data: { status: "ACTIVE" },
        }),
      ]);

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
}
