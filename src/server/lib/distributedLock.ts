// src/server/lib/distributedLock.ts
// ─── Distributed Locking via Upstash Redis ───────────────────────────────────
// Prevents concurrent processing of the same resource across serverless
// function instances (e.g. double-release, double-refund).
//
// Sentinel value 'NO_REDIS_LOCK':
//   Returned when Redis is unavailable (dev/test or network issue).
//   withLock() treats this as "lock acquired" and proceeds without blocking.
//   This lets the code function in environments without Redis while still
//   being safe in production where Redis is always configured.
//
// Lock acquisition uses SET NX EX — a single atomic Redis command that sets
// the key only if it doesn't exist and automatically expires after ttlSeconds.
//
// Lock release uses a Lua script (compare-and-delete) to ensure only the
// process that acquired the lock can release it.

import { logger } from '@/shared/logger'

const NO_REDIS_LOCK = 'NO_REDIS_LOCK'

/**
 * Attempt to acquire a distributed lock for the given resource.
 *
 * Returns:
 *   - A non-empty lock value string on success (pass to releaseLock)
 *   - 'NO_REDIS_LOCK' sentinel if Redis is unavailable (proceeds without lock)
 *   - null if the lock is currently held by another process
 */
export async function acquireLock(
  resource: string,
  ttlSeconds = 30
): Promise<string | null> {
  try {
    const { getRedisClient } = await import('@/infrastructure/redis/client')
    const redis = getRedisClient()
    const lockValue = `lock:${Date.now()}:${Math.random().toString(36).slice(2)}`
    const key = `km:lock:${resource}`

    // SET NX EX — atomic: only set if key doesn't exist, auto-expire after TTL
    // Returns 'OK' if acquired, null if another process holds the lock
    const result = await redis.set(key, lockValue, { nx: true, ex: ttlSeconds })

    if (result === 'OK') {
      return lockValue
    }
    return null // Lock held by another process
  } catch {
    // Redis unavailable — return sentinel to allow non-blocking operation
    logger.warn('distributedLock.redis_unavailable', { resource })
    return NO_REDIS_LOCK
  }
}

/**
 * Release a lock previously acquired via acquireLock().
 * No-op if lockValue is the NO_REDIS_LOCK sentinel.
 *
 * Uses a Lua compare-and-delete to ensure only the lock owner can release.
 */
export async function releaseLock(
  resource: string,
  lockValue: string
): Promise<void> {
  if (lockValue === NO_REDIS_LOCK) return

  try {
    const { getRedisClient } = await import('@/infrastructure/redis/client')
    const redis = getRedisClient()
    const key = `km:lock:${resource}`

    // Lua compare-and-delete: only delete if we still own the lock
    const script =
      'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end'
    await redis.eval(script, [key], [lockValue])
  } catch {
    // Non-fatal — TTL will clean up the key automatically
    logger.warn('distributedLock.release_failed', { resource })
  }
}

/**
 * Acquire a lock, run fn(), release the lock in a finally block.
 *
 * Throws if the lock is currently held by another process (lockValue === null).
 * Callers should catch this and treat it as "already processing".
 *
 * If Redis is unavailable, proceeds without locking (sentinel path).
 */
export async function withLock<T>(
  resource: string,
  fn: () => Promise<T>,
  ttlSeconds = 30
): Promise<T> {
  const lockValue = await acquireLock(resource, ttlSeconds)

  if (lockValue === null) {
    throw new Error(`Failed to acquire lock for resource: ${resource}`)
  }

  // Redis unavailable — sentinel returned, proceeding without lock.
  // transitionOrder() optimistic locking still prevents double-mutations,
  // but the distributed lock guarantee is violated.
  if (lockValue === NO_REDIS_LOCK) {
    if (process.env.NODE_ENV === 'production') {
      // ERROR level so monitoring/alerting picks this up immediately.
      // A Redis outage in production means dispute resolution, escrow release,
      // and offer acceptance lose their distributed concurrency guarantee.
      logger.error('distributedLock.redis_unavailable_production', {
        resource,
        message:
          'Redis unavailable in PRODUCTION — distributed lock bypassed. ' +
          'Concurrent operations may proceed without mutual exclusion. ' +
          'Check Redis connectivity immediately.',
      })
    }
    return await fn()
  }

  try {
    return await fn()
  } finally {
    await releaseLock(resource, lockValue)
  }
}
