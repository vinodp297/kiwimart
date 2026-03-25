// src/infrastructure/redis/client.ts
// ─── Upstash Redis Singleton ──────────────────────────────────────────────────
// Single @upstash/redis instance for the entire codebase.
// Used for rate limiting, caching, and simple key-value operations.
// (BullMQ queues use ioredis — see src/infrastructure/queue/client.ts)

import { Redis } from '@upstash/redis'

let _redis: Redis | null = null

/**
 * Returns the shared Upstash Redis client.
 * Throws if UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN are not set.
 */
export function getRedisClient(): Redis {
  if (_redis) return _redis

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error(
      'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required'
    )
  }

  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })

  return _redis
}
