// src/server/lib/distributedLock.ts
// ─── Distributed Locking via Upstash Redis ───────────────────────────────────
// Prevents concurrent processing of the same resource across serverless
// function instances (e.g. double-release, double-refund).
//
// acquireLock() returns:
//   string  — lock value on success (pass to releaseLock)
//   null    — lock NOT acquired (Redis unavailable OR held by another process)
//
// Both failure modes return null — callers must treat null as "do not proceed".
// This is fail-closed: financial operations are never attempted without a lock.
//
// Lock acquisition uses SET NX EX — a single atomic Redis command that sets
// the key only if it doesn't exist and automatically expires after ttlSeconds.
//
// Lock release uses a Lua script (compare-and-delete) to ensure only the
// process that acquired the lock can release it.

import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";

/**
 * Attempt to acquire a distributed lock for the given resource.
 *
 * Returns:
 *   - A non-empty lock value string on success (pass to releaseLock)
 *   - null if the lock is held by another process OR if Redis is unavailable
 *
 * Callers MUST treat null as "do not proceed" — it is always fail-closed.
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
    // Redis unavailable — return null so callers fail closed.
    // No operation requiring a distributed lock should proceed without Redis.
    logger.warn("distributedLock.redis_unavailable", { resource });
    return null;
  }
}

/**
 * Release a lock previously acquired via acquireLock().
 * No-op if lockValue is falsy (null/undefined/empty string).
 *
 * Uses a Lua compare-and-delete to ensure only the lock owner can release.
 */
export async function releaseLock(
  resource: string,
  lockValue: string,
): Promise<void> {
  if (!lockValue) return;

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
 * Throws if the lock cannot be acquired (null return from acquireLock).
 * This covers both "held by another process" and "Redis unavailable".
 *
 * Callers should catch this and treat it as "already processing" or
 * "temporarily unavailable".
 *
 * options.failOpen — if true, proceeds without lock when Redis is unavailable
 *   (use only for non-critical, idempotent operations)
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
    if (failOpen) {
      // Caller explicitly opted in to fail-open (non-critical operation)
      logger.warn("distributedLock.lock_unavailable_failopen", {
        resource,
        message: "Proceeding without lock (failOpen: true)",
      });
      return await fn();
    }

    if (process.env.NODE_ENV !== "production") {
      // Dev — Redis may not be running locally. Proceed without lock so
      // the app works without a local Redis instance.
      logger.warn("distributedLock.lock_unavailable_dev", {
        resource,
        message: "Lock not acquired in dev — proceeding without lock",
      });
      return await fn();
    }

    // PRODUCTION fail-closed — lock held or Redis unavailable.
    // Either way, reject the operation to prevent concurrent mutations.
    logger.error("distributedLock.lock_unavailable_production", {
      resource,
      message:
        "Lock not acquired in PRODUCTION — failing CLOSED. " +
        "Check Redis connectivity and concurrent execution.",
    });
    throw new AppError(
      "CONCURRENT_MODIFICATION",
      `Failed to acquire lock for resource: ${resource}`,
      409,
    );
  }

  try {
    return await fn();
  } finally {
    await releaseLock(resource, lockValue);
  }
}
