// src/server/lib/sessionStore.ts
// ─── Redis-backed session version tracking ──────────────────────────────────
// Each user has a monotonically-increasing session version in Redis.
// When the user signs out, the version is incremented.  Every JWT carries
// the version it was issued with; on each request the jwt() callback
// compares the token's version to the current Redis version.
// If currentVersion > tokenVersion → the token predates the last sign-out
// → reject it immediately, defeating Chrome bfcache restore attacks.
//
// Fail-open: if Redis is down, getSessionVersion returns 0 and all tokens
// are considered valid.  The user's cookie is still cleared by Auth.js, so
// the only window is a stolen-token scenario limited to the 1-hour JWT TTL.

import { getRedisClient } from '@/infrastructure/redis/client'
import { logger } from '@/shared/logger'

const SESSION_VERSION_PREFIX = 'session:version:'
const SESSION_TTL = 60 * 60 * 24 * 30 // 30 days

/**
 * Get the current valid session version for a user.
 * Returns 0 if no version is set (all sessions valid by default) or if
 * Redis is unavailable (fail-open).
 */
export async function getSessionVersion(userId: string): Promise<number> {
  try {
    const redis = getRedisClient()
    const version = await redis.get(`${SESSION_VERSION_PREFIX}${userId}`)
    return version ? parseInt(version as string, 10) : 0
  } catch (e) {
    logger.warn('sessionStore.getVersion.failed', {
      userId,
      error: e instanceof Error ? e.message : String(e),
    })
    return 0 // fail open
  }
}

/**
 * Increment the session version — invalidates ALL existing JWTs for the user
 * across every device/tab.  Returns the new version, or 0 if Redis is down.
 */
export async function invalidateAllSessions(userId: string): Promise<number> {
  try {
    const redis = getRedisClient()
    const newVersion = await redis.incr(`${SESSION_VERSION_PREFIX}${userId}`)
    await redis.expire(`${SESSION_VERSION_PREFIX}${userId}`, SESSION_TTL)
    logger.info('sessionStore.invalidated', { userId, newVersion })
    return newVersion
  } catch (e) {
    logger.warn('sessionStore.invalidate.failed', {
      userId,
      error: e instanceof Error ? e.message : String(e),
    })
    return 0
  }
}
