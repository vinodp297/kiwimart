// src/server/lib/mfaSession.ts
// ─── MFA Session Verification (Redis) ───────────────────────────────────────
// After a user passes TOTP verification, their JWT's jti is stored here.
// The jwt() callback checks this to clear the mfaPending flag.

import { getRedisClient } from "@/infrastructure/redis/client";
import { logger } from "@/shared/logger";

const MFA_VERIFIED_PREFIX = "mfa:verified:";
// 1 hour — intentionally longer than JWT maxAge (900 s / 15 min) so that the
// verified flag survives silent token refreshes within an active session.
const MFA_TTL_SECONDS = 60 * 60;

/**
 * Mark a JWT as MFA-verified.
 */
export async function markMfaVerified(jti: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(`${MFA_VERIFIED_PREFIX}${jti}`, "1", {
      ex: MFA_TTL_SECONDS,
    });
  } catch (err) {
    logger.warn("mfa.session.mark.failed", {
      jti,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Check if a JWT has been MFA-verified.
 * Fail-open: if Redis is unavailable, returns false (user must re-verify).
 */
export async function isMfaVerified(jti: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const result = await redis.get(`${MFA_VERIFIED_PREFIX}${jti}`);
    return result === "1";
  } catch {
    return false;
  }
}
