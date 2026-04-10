// src/server/lib/sessionStore.ts
// ─── Redis-backed session version tracking ──────────────────────────────────
// Each user has a monotonically-increasing session version in Redis.
// When the user signs out, the version is incremented.  Every JWT carries
// the version it was issued with; on each request the jwt() callback
// compares the token's version to the current Redis version.
// If currentVersion > tokenVersion → the token predates the last sign-out
// → reject it immediately, defeating Chrome bfcache restore attacks.
//
// Fail-open by default; fail-closed for admin operations via options.failClosed.

import { getRedisClient } from "@/infrastructure/redis/client";
import { logger } from "@/shared/logger";
import { WEB_SESSION_TTL_SECONDS } from "@/lib/auth-constants";

const SESSION_VERSION_PREFIX = "session:version:";
const SESSION_TTL = WEB_SESSION_TTL_SECONDS;

/**
 * Get the current valid session version for a user.
 *
 * @param userId - The user's ID
 * @param options.failClosed - If true, return Infinity (force-invalidate all
 *   sessions) when Redis is unavailable. Use for admin/privileged operations.
 */
export async function getSessionVersion(
  userId: string,
  options?: { failClosed?: boolean },
): Promise<number> {
  try {
    const redis = getRedisClient();
    const version = await redis.get(`${SESSION_VERSION_PREFIX}${userId}`);
    return version ? parseInt(version as string, 10) : 0;
  } catch (e) {
    if (options?.failClosed) {
      logger.warn(
        "sessionStore: Redis unavailable, failing CLOSED for privileged operation",
        {
          userId,
          error: e instanceof Error ? e.message : String(e),
        },
      );
      return Infinity; // Force session invalid — blocks all tokens
    }
    logger.warn("sessionStore.getVersion.failed", {
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    return 0; // fail open
  }
}

/**
 * Increment the session version — invalidates ALL existing JWTs for the user
 * across every device/tab.  Returns the new version, or 0 if Redis is down.
 */
export async function invalidateAllSessions(userId: string): Promise<number> {
  try {
    const redis = getRedisClient();
    const newVersion = await redis.incr(`${SESSION_VERSION_PREFIX}${userId}`);
    await redis.expire(`${SESSION_VERSION_PREFIX}${userId}`, SESSION_TTL);
    logger.info("sessionStore.invalidated", { userId, newVersion });
    return newVersion;
  } catch (e) {
    logger.warn("sessionStore.invalidate.failed", {
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }
}
