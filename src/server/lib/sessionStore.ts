// src/server/lib/sessionStore.ts
// ─── Redis-backed session version tracking ──────────────────────────────────
// Each user has a monotonically-increasing session version in Redis.
// When the user signs out, the version is incremented.  Every JWT carries
// the version it was issued with; on each request the jwt() callback
// compares the token's version to the current Redis version.
// If currentVersion > tokenVersion → the token predates the last sign-out
// → reject it immediately, defeating Chrome bfcache restore attacks.
//
// Fail-open is no longer used for any path.  If Redis is unavailable:
//   1. A 60-second in-memory cache (populated on every successful Redis read)
//      is checked first.  If a fresh entry exists, it is returned.
//   2. If the cache is empty or stale, Infinity is returned — every JWT
//      version comparison (currentVersion > tokenVersion) evaluates true,
//      effectively invalidating all sessions until Redis recovers.
//
// This is deliberately fail-CLOSED: a force-revoked session must NOT remain
// valid during a Redis outage, even for non-admin users.

import { getRedisClient } from "@/infrastructure/redis/client";
import { logger } from "@/shared/logger";
import { WEB_SESSION_TTL_SECONDS } from "@/lib/auth-constants";

const SESSION_VERSION_PREFIX = "session:version:";
const SESSION_TTL = WEB_SESSION_TTL_SECONDS;

// ── In-memory fallback cache ────────────────────────────────────────────────
// Populated on every successful Redis read so we have a recent value to serve
// during short Redis outages without falling back to fail-open.
// TTL is intentionally short (60 s) — stale revocations only survive briefly.

const VERSION_CACHE_TTL_MS = 60_000; // 60 seconds

interface VersionCacheEntry {
  version: number;
  expiresAt: number;
}

/**
 * Module-level in-memory fallback cache.
 * Exported with a leading underscore to signal test-only access.
 * Production code must not read this map directly.
 */
export const _sessionVersionCache = new Map<string, VersionCacheEntry>();

/**
 * Get the current valid session version for a user.
 *
 * Fallback strategy when Redis is unavailable:
 *   1. Return the in-memory cached version if it is fresh (< 60 s old).
 *   2. Otherwise return Infinity — effectively invalidating all sessions
 *      until Redis recovers (fail-closed).
 *
 * @param userId - The user's ID
 * @param options.failClosed - Kept for call-site backward-compatibility.
 *   Infinity is returned on cache-miss regardless of this flag.
 */
export async function getSessionVersion(
  userId: string,
  options?: { failClosed?: boolean },
): Promise<number> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(`${SESSION_VERSION_PREFIX}${userId}`);
    const version = raw ? parseInt(raw as string, 10) : 0;

    // Populate the memory cache on every successful Redis read so the
    // fallback stays warm even during brief Redis interruptions.
    _sessionVersionCache.set(userId, {
      version,
      expiresAt: Date.now() + VERSION_CACHE_TTL_MS,
    });

    return version;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);

    // ── Fallback: check in-memory cache ──────────────────────────────────
    const cached = _sessionVersionCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      logger.warn("sessionStore.getVersion.memory_cache_fallback", {
        userId,
        error: errorMsg,
      });
      return cached.version;
    }

    // No fresh cache entry — fail CLOSED.
    // Returning Infinity ensures every JWT version comparison evaluates true,
    // invalidating all existing sessions until Redis recovers.
    if (options?.failClosed) {
      logger.warn(
        "sessionStore: Redis unavailable, failing CLOSED for privileged operation",
        { userId, error: errorMsg },
      );
    } else {
      logger.warn("sessionStore.getVersion.fail_closed_no_cache", {
        userId,
        error: errorMsg,
      });
    }

    return Infinity;
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

    // Keep the memory cache consistent after invalidation so requests
    // that hit the fallback path during a partial outage see the new version.
    _sessionVersionCache.set(userId, {
      version: newVersion,
      expiresAt: Date.now() + VERSION_CACHE_TTL_MS,
    });

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
