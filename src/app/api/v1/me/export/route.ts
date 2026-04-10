// src/app/api/v1/me/export/route.ts
// ─── Personal Data Export — NZ Privacy Act 2020 IPP 6 ────────────────────────
// GET /api/v1/me/export
//   Returns all personal data for the authenticated user as a downloadable JSON
//   file (Content-Disposition: attachment). No email or R2 upload — the data is
//   streamed directly to the browser.
//
// Rate limit: once per 24 hours per user.
//   Redis key: export:cooldown:{userId}
//   TTL: 86 400 seconds
//
// Sensitive fields are NEVER included in the export payload:
//   passwordHash, stripeAccountId, mfaSecret, mfaBackupCodes,
//   sessionVersion, twoFactorSecret, pushTokens

import { requireApiUser, apiError } from "../../_helpers/response";
import { getCorsHeaders } from "../../_helpers/cors";
import { handleRouteError } from "@/server/lib/handle-route-error";
import { getRedisClient } from "@/infrastructure/redis/client";
import { exportRepository } from "@/modules/users/export.repository";
import { logger } from "@/shared/logger";
import { MS_PER_DAY, SECONDS_PER_DAY } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Redis key for the 24-hour export cooldown. */
const cooldownKey = (userId: string) => `export:cooldown:${userId}`;

/** 24-hour cooldown between exports. */
const COOLDOWN_TTL = SECONDS_PER_DAY; // 86 400 s

/** Fields that must never appear in any export payload. */
const SENSITIVE_FIELDS = new Set([
  "passwordHash",
  "stripeAccountId",
  "mfaSecret",
  "mfaBackupCodes",
  "sessionVersion",
  "twoFactorSecret",
  "pushTokens",
]);

/**
 * Strips any sensitive internal fields from a profile object.
 * Acts as defence-in-depth even when the DB query already uses a safe select.
 */
function sanitizeProfile(
  profile: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!profile) return null;
  const sanitized = { ...profile };
  for (const key of SENSITIVE_FIELDS) {
    delete sanitized[key];
  }
  return sanitized;
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);

    // ── Rate limit: 1 export per 24 hours ───────────────────────────────────
    let redis: ReturnType<typeof getRedisClient> | null = null;
    try {
      redis = getRedisClient();
      const existing = await redis.get(cooldownKey(user.id));
      if (existing) {
        return apiError(
          "You can only export your data once every 24 hours. Please try again later.",
          429,
          "EXPORT_RATE_LIMITED",
        );
      }
    } catch {
      // Redis unavailable — fail open so the user's right of access is upheld.
      logger.warn("me.export.redis_unavailable", { userId: user.id });
    }

    // ── Collect all personal data in parallel ────────────────────────────────
    const ninetyDaysAgo = new Date(Date.now() - 90 * MS_PER_DAY);

    const [
      rawProfile,
      listings,
      ordersAsBuyer,
      ordersAsSeller,
      reviewsGiven,
      reviewsReceived,
      messages,
      disputes,
    ] = await Promise.all([
      // Profile — exportRepository already uses a safe select, but we strip
      // again below as a second line of defence.
      exportRepository.findProfile(user.id),

      // Listings created by this user
      exportRepository.findListings(user.id),

      // Orders where the user was the buyer
      exportRepository.findOrdersAsBuyer(user.id),

      // Orders where the user was the seller
      exportRepository.findOrdersAsSeller(user.id),

      // Reviews this user authored
      exportRepository.findReviewsGiven(user.id),

      // Reviews this user received (as the subject)
      exportRepository.findReviewsReceived(user.id),

      // Messages sent in the last 90 days (privacy-conscious limit)
      exportRepository.findRecentMessages(user.id, ninetyDaysAgo),

      // Dispute history — joined via order (Dispute has no direct userId fields)
      exportRepository.findDisputes(user.id),
    ]);

    // ── Build the export payload ─────────────────────────────────────────────
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      // Schema version so consumers can handle future format changes
      schemaVersion: "1.0",
      profile: sanitizeProfile(rawProfile as Record<string, unknown> | null),
      listings,
      ordersAsBuyer,
      ordersAsSeller,
      reviewsGiven,
      reviewsReceived,
      messages,
      disputes,
    };

    // ── Set rate-limit key AFTER successful collection ───────────────────────
    // Only reached when all DB queries succeeded. If they threw, the user can
    // try again immediately.
    if (redis) {
      try {
        await redis.set(cooldownKey(user.id), new Date().toISOString(), {
          ex: COOLDOWN_TTL,
        });
      } catch {
        logger.warn("me.export.redis_set_failed", { userId: user.id });
      }
    }

    logger.info("me.export.served", { userId: user.id });

    return new Response(JSON.stringify(exportPayload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="buyzi-data-export.json"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return handleRouteError(e, { path: "GET /api/v1/me/export" });
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
