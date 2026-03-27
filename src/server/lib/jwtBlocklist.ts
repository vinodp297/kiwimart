// src/server/lib/jwtBlocklist.ts
// ─── Redis-backed JWT blocklist ───────────────────────────────────────────────
// When a user signs out, their JWT's jti is added here with a TTL that matches
// the token's remaining lifetime.  The jwt() callback checks this on every
// request, so a stolen-but-not-yet-expired token is rejected immediately.
//
// Fail-open: if Redis is unavailable the app keeps working — the user's cookie
// is still cleared by Auth.js, so only a stolen token would be a concern, and
// only until it naturally expires (now capped at 1 hour).

import { getRedisClient } from '@/infrastructure/redis/client'
import { logger } from '@/shared/logger'

const BLOCKLIST_PREFIX = 'jwt:blocklist:'
const PADDING_SECONDS = 60 // extra buffer so the key outlives the token slightly

/**
 * Add a JWT to the blocklist.
 * TTL = (token expiry - now) + PADDING_SECONDS.
 * Silently no-ops if Redis is unavailable or the token is already expired.
 */
export async function blockToken(jti: string, expiresAt: number): Promise<void> {
  try {
    const redis = getRedisClient()
    const ttl = expiresAt - Math.floor(Date.now() / 1000) + PADDING_SECONDS
    if (ttl <= 0) return // token already expired — nothing to block
    await redis.set(`${BLOCKLIST_PREFIX}${jti}`, '1', { ex: ttl })
  } catch (err) {
    logger.warn('jwt.blocklist.block.failed', {
      jti,
      error: err instanceof Error ? err.message : String(err),
    })
    // Do NOT rethrow — sign-out must succeed even if Redis is down
  }
}

/**
 * Returns true if the JWT has been blocklisted (i.e. the user signed out).
 * Returns false (fail-open) if Redis is unavailable.
 */
export async function isTokenBlocked(jti: string): Promise<boolean> {
  try {
    const redis = getRedisClient()
    const result = await redis.get(`${BLOCKLIST_PREFIX}${jti}`)
    return result === '1'
  } catch {
    // Redis unavailable — allow the request (fail open)
    return false
  }
}
