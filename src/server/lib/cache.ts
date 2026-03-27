// src/server/lib/cache.ts
// ─── Redis Cache Layer ───────────────────────────────────────────────────────
// Thin wrapper around Upstash Redis for read-through caching.
// Falls back to direct DB fetch if Redis is unavailable.

import { getRedisClient } from '@/infrastructure/redis/client'
import { logger } from '@/shared/logger'

/**
 * Read-through cache: returns cached value if available, otherwise
 * calls fetcher(), stores the result, and returns it.
 *
 * @param key - Redis key (e.g. 'stats:homepage', 'seller:stats:abc')
 * @param fetcher - Async function that produces the fresh data
 * @param ttlSeconds - Cache TTL in seconds (default: 300 = 5 minutes)
 */
export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  try {
    const redis = getRedisClient()
    const cached = await redis.get(key)
    if (cached !== null && cached !== undefined) {
      return (typeof cached === 'string' ? JSON.parse(cached) : cached) as T
    }
  } catch (e) {
    logger.warn('cache.get.failed', { key, error: e instanceof Error ? e.message : String(e) })
  }

  // Fetch fresh data
  const data = await fetcher()

  // Store in cache (fire-and-forget — don't block the response)
  try {
    const redis = getRedisClient()
    await redis.set(key, JSON.stringify(data), { ex: ttlSeconds })
  } catch (e) {
    logger.warn('cache.set.failed', { key, error: e instanceof Error ? e.message : String(e) })
  }

  return data
}

/**
 * Invalidate one or more cache keys.
 * Silently fails if Redis is unavailable.
 */
export async function invalidateCache(...keys: string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    const redis = getRedisClient()
    await redis.del(...keys)
  } catch (e) {
    logger.warn('cache.invalidate.failed', { keys, error: e instanceof Error ? e.message : String(e) })
  }
}
