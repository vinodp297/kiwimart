// src/modules/users/export.service.ts
// ─── PII Data Export Service ──────────────────────────────────────────────────
// Collects all personal data for a user and delivers it via a signed R2 URL.
// Rate limited: once per 30 days per user (tracked in Redis).
//
// Export flow:
//   1. Rate-limit check (Redis)
//   2. Collect all PII from the database
//   3. Serialise to JSON and upload to Cloudflare R2
//      Key: exports/{userId}/{timestamp}-data-export.json
//   4. Generate a presigned GET URL with a 24-hour TTL
//   5. Email ONLY the signed URL to the user — never the raw JSON data
//   6. Mark the 30-day rate-limit key in Redis
//
// Privacy notes:
//   • The JSON export data is NEVER sent via email — only the signed URL.
//   • The signed URL is time-limited (24 h) and single-tenant (userId in path).
//   • Export files are cleaned up after 24 h by cleanupExportFiles.ts.

import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { exportRepository } from "./export.repository";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";
import { getRedisClient } from "@/infrastructure/redis/client";
import { enqueueEmail } from "@/lib/email-queue";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";

const EXPORT_COOLDOWN_SECONDS = 30 * 24 * 60 * 60; // 30 days
const EXPORT_REDIS_PREFIX = "data_export:";

/** 24-hour TTL for the presigned download URL and the R2 object. */
export const EXPORT_URL_TTL_SECONDS = 24 * 60 * 60; // 86 400 s

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
    exportRepository.findProfile(userId),
    exportRepository.findOrders(userId),
    exportRepository.findMessages(userId),
    exportRepository.findReviews(userId),
    exportRepository.findListings(userId),
    exportRepository.findOffersMade(userId),
    exportRepository.findOffersReceived(userId),
    exportRepository.findWatchlist(userId),
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
 * Full export flow:
 *   rate-check → collect → upload to R2 → generate signed URL → email URL → mark cooldown.
 *
 * The JSON data is uploaded to R2 and NEVER sent via email.
 * If the R2 upload or signed URL generation fails, the function throws and
 * the rate-limit key is NOT set (so the user can try again).
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

  // Step 1: Collect all PII
  const data = await collectUserData(userId);
  const jsonPayload = JSON.stringify(data, null, 2);

  // Step 2: Upload JSON to R2
  // Key includes userId so exports are namespaced per user and easy to audit.
  // Timestamp uses ISO 8601 with colons replaced to produce a safe filename.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const r2Key = `exports/${userId}/${timestamp}-data-export.json`;

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: Buffer.from(jsonPayload, "utf-8"),
      ContentType: "application/json",
      Metadata: {
        userId,
        exportedAt: new Date().toISOString(),
      },
    }),
  );
  // If the upload throws, the function fails here — no rate-limit mark, no email.

  // Step 3: Generate presigned GET URL with 24-hour TTL
  const downloadUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      ResponseContentDisposition:
        'attachment; filename="buyzi-data-export.json"',
    }),
    { expiresIn: EXPORT_URL_TTL_SECONDS },
  );

  // Human-readable expiry in NZ time for the email body
  const expiresAt = new Date(
    Date.now() + EXPORT_URL_TTL_SECONDS * 1000,
  ).toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland",
    dateStyle: "medium",
    timeStyle: "short",
  });

  // Step 4: Email ONLY the signed URL — the JSON data is never sent via email
  await enqueueEmail({
    template: "dataExport",
    to: userEmail,
    displayName: data.profile?.displayName ?? "User",
    downloadUrl,
    expiresAt,
  }).catch((err) => {
    logger.warn("export.email_queue.failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Step 5: Mark the 30-day rate-limit key (after everything else succeeds)
  await markExportRequested(userId);

  logger.info("account.data_exported", { userId, r2Key });
}
