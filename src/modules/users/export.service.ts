// src/modules/users/export.service.ts
// Collects all personal data for a user and sends it via email.
// Rate limited: once per 30 days per user (tracked in Redis).

import db from "@/lib/db";
import { getRedisClient } from "@/infrastructure/redis/client";
import { enqueueEmail } from "@/lib/email-queue";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";

const EXPORT_COOLDOWN_SECONDS = 30 * 24 * 60 * 60; // 30 days
const EXPORT_REDIS_PREFIX = "data_export:";

/** Check whether the user can request a new export (30-day cooldown). */
export async function canRequestExport(userId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const lastExport = await redis.get(`${EXPORT_REDIS_PREFIX}${userId}`);
    return !lastExport;
  } catch {
    // Redis unavailable — allow the export (fail open for user rights)
    return true;
  }
}

/** Mark that the user has requested an export (sets 30-day TTL in Redis). */
async function markExportRequested(userId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(
      `${EXPORT_REDIS_PREFIX}${userId}`,
      new Date().toISOString(),
      { ex: EXPORT_COOLDOWN_SECONDS },
    );
  } catch {
    logger.warn("export.rate_limit.redis_failed", { userId });
  }
}

/**
 * Collects all PII for a user and returns it as a structured object.
 *
 * Collected models:
 *   • Profile (User record — PII fields only)
 *   • Orders (all, with items and status history)
 *   • Messages (all sent messages)
 *   • Reviews (written by user)
 *   • Listings (created by user)
 *   • Offers (made and received)
 *   • Watchlist items
 *
 * NEVER includes: passwordHash, mfaSecret, mfaBackupCodes, internal tokens
 */
export async function collectUserData(userId: string) {
  const [
    user,
    orders,
    messages,
    reviews,
    listings,
    offersMade,
    offersReceived,
    watchlist,
  ] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        bio: true,
        phone: true,
        isPhoneVerified: true,
        region: true,
        suburb: true,
        dateOfBirth: true,
        idVerified: true,
        nzbn: true,
        gstNumber: true,
        isSellerEnabled: true,
        hasMarketingConsent: true,
        createdAt: true,
        updatedAt: true,
        // NEVER: passwordHash, mfaSecret, mfaBackupCodes
      },
    }),
    db.order.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: {
        id: true,
        status: true,
        itemNzd: true,
        shippingNzd: true,
        totalNzd: true,
        fulfillmentType: true,
        shippingName: true,
        shippingLine1: true,
        shippingLine2: true,
        shippingCity: true,
        shippingRegion: true,
        shippingPostcode: true,
        trackingNumber: true,
        createdAt: true,
        completedAt: true,
        cancelledAt: true,
        cancelReason: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.message.findMany({
      where: { senderId: userId },
      select: {
        id: true,
        body: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.review.findMany({
      where: { authorId: userId },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.listing.findMany({
      where: { sellerId: userId },
      select: {
        id: true,
        title: true,
        description: true,
        priceNzd: true,
        condition: true,
        status: true,
        region: true,
        suburb: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.offer.findMany({
      where: { buyerId: userId },
      select: {
        id: true,
        amountNzd: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.offer.findMany({
      where: { sellerId: userId },
      select: {
        id: true,
        amountNzd: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.watchlistItem.findMany({
      where: { userId },
      select: {
        id: true,
        listingId: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    userId,
    profile: user,
    orders,
    messages,
    reviews,
    listings,
    offersMade,
    offersReceived,
    watchlist,
  };
}

/**
 * Full export flow: rate-check → collect → email → mark cooldown.
 */
export async function exportUserData(
  userId: string,
  userEmail: string,
): Promise<void> {
  const isAllowed = await canRequestExport(userId);
  if (!isAllowed) {
    throw new AppError(
      "EXPORT_RATE_LIMITED",
      "You can only request a data export once every 30 days. Please try again later.",
      429,
    );
  }

  const data = await collectUserData(userId);
  const jsonPayload = JSON.stringify(data, null, 2);

  await enqueueEmail({
    template: "dataExport",
    to: userEmail,
    displayName: data.profile?.displayName ?? "User",
    jsonPayload,
  }).catch((err) => {
    logger.warn("export.email_queue.failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  await markExportRequested(userId);

  logger.info("account.data_exported", { userId });
}
