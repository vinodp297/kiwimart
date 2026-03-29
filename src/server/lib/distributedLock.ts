// src/server/lib/distributedLock.ts
// ─── Distributed Locking via Upstash Redis ───────────────────────────────────
// Prevents concurrent processing of the same resource across serverless
// function instances (e.g. double-release, double-refund).
//
// Sentinel value 'NO_REDIS_LOCK':
//   Returned by acquireLock() when Redis is unavailable.
//   In PRODUCTION: withLock() THROWS — fail-closed. No money operation
//   should proceed without concurrency protection.
//   In DEV/TEST: withLock() proceeds without lock so the app works
//   without Redis configured locally.
//
// Lock acquisition uses SET NX EX — a single atomic Redis command that sets
// the key only if it doesn't exist and automatically expires after ttlSeconds.
//
// Lock release uses a Lua script (compare-and-delete) to ensure only the
// process that acquired the lock can release it.

import { logger } from "@/shared/logger";

const NO_REDIS_LOCK = "NO_REDIS_LOCK";

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
  ttlSeconds = 30,
): Promise<string | null> {
  try {
    const { getRedisClient } = await import("@/infrastructure/redis/client");
    const redis = getRedisClient();
    const lockValue = `lock:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const key = `km:lock:${resource}`;

    // SET NX EX — atomic: only set if key doesn't exist, auto-expire after TTL
    // Returns 'OK' if acquired, null if another process holds the lock
    const result = await redis.set(key, lockValue, {
      nx: true,
      ex: ttlSeconds,
    });

    if (result === "OK") {
      return lockValue;
    }
    return null; // Lock held by another process
  } catch {
    // Redis unavailable — return sentinel to allow non-blocking operation
    logger.warn("distributedLock.redis_unavailable", { resource });
    return NO_REDIS_LOCK;
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
  lockValue: string,
): Promise<void> {
  if (lockValue === NO_REDIS_LOCK) return;

  try {
    const { getRedisClient } = await import("@/infrastructure/redis/client");
    const redis = getRedisClient();
    const key = `km:lock:${resource}`;

    // Lua compare-and-delete: only delete if we still own the lock
    const script =
      'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';
    await redis.eval(script, [key], [lockValue]);
  } catch {
    // Non-fatal — TTL will clean up the key automatically
    logger.warn("distributedLock.release_failed", { resource });
  }
}

/**
 * Acquire a lock, run fn(), release the lock in a finally block.
 *
 * Throws if the lock is currently held by another process (lockValue === null).
 * Callers should catch this and treat it as "already processing".
 *
 * When Redis is unavailable:
 *   - failOpen: false (default) — throws in production, warns and proceeds in dev/test
 *   - failOpen: true — proceeds without lock (use only for non-critical operations)
 */
export async function withLock<T>(
  resource: string,
  fn: () => Promise<T>,
  options?: { failOpen?: boolean; ttlSeconds?: number },
): Promise<T> {
  // Tests run in isolation with mocked dependencies — skip Redis entirely
  // to prevent hanging on a connection that will never resolve.
  if (process.env.NODE_ENV === "test") {
    return fn();
  }

  const { failOpen = false, ttlSeconds = 30 } = options ?? {};
  const lockValue = await acquireLock(resource, ttlSeconds);

  if (lockValue === null) {
    throw new Error(`Failed to acquire lock for resource: ${resource}`);
  }

  // Redis unavailable — sentinel returned.
  if (lockValue === NO_REDIS_LOCK) {
    if (failOpen) {
      // Caller explicitly opted in to fail-open (non-critical operation)
      logger.warn("distributedLock.redis_unavailable_failopen", {
        resource,
        message: "Proceeding without lock (failOpen: true)",
      });
      return await fn();
    }

    if (process.env.NODE_ENV !== "production") {
      // Dev/test — proceed without lock so the app works without Redis
      logger.warn("distributedLock.redis_unavailable_dev", {
        resource,
        message: "Proceeding without lock (dev/test only)",
      });
      return await fn();
    }

    // PRODUCTION fail-closed — no money operation should proceed without
    // concurrency protection.
    logger.error("distributedLock.redis_unavailable_production", {
      resource,
      message:
        "Redis unavailable in PRODUCTION — failing CLOSED. " +
        "Check Redis connectivity immediately.",
    });
    throw new Error(
      "Lock unavailable — Redis is down. Operation rejected to prevent concurrent mutations.",
    );
  }

  try {
    return await fn();
  } finally {
    await releaseLock(resource, lockValue);
  }
}
