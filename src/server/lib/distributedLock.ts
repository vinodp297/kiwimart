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

import { randomUUID } from "crypto";
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
    const lockValue = `lock:${randomUUID()}`;
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
 * Internal helper used by withLock to distinguish "lock held" from "Redis unavailable".
 * Public acquireLock() is unchanged so cron jobs using `if (!lockValue) return` work as before.
 */
type LockAcquireResult =
  | { acquired: true; value: string }
  | { acquired: false; reason: "held" | "unavailable" };

async function acquireLockWithReason(
  resource: string,
  ttlSeconds: number,
): Promise<LockAcquireResult> {
  try {
    const { getRedisClient } = await import("@/infrastructure/redis/client");
    const redis = getRedisClient();
    const lockValue = `lock:${randomUUID()}`;
    const key = `km:lock:${resource}`;

    const result = await redis.set(key, lockValue, {
      nx: true,
      ex: ttlSeconds,
    });

    if (result === "OK") {
      return { acquired: true, value: lockValue };
    }
    return { acquired: false, reason: "held" };
  } catch {
    logger.warn("distributedLock.redis_unavailable", { resource });
    return { acquired: false, reason: "unavailable" };
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
 * Throws if the lock cannot be acquired. This covers both "held by another
 * process" (LOCK_CONTENTION → 409) and "Redis unavailable" (LOCK_UNAVAILABLE → 503).
 *
 * Behaviour is identical in dev and production — there is NO environment-based
 * fallback. If you are working locally without Redis, set UPSTASH_REDIS_REST_URL
 * to a local instance, OR pass `failOpen: true` for the specific call.
 * Silently bypassing the lock in dev hides bugs that only appear in production.
 *
 * options.failOpen — if true, proceeds without lock when the lock cannot be
 *   acquired (Redis unavailable OR held by another process).
 *   Use only for genuinely non-critical, idempotent operations. Callers MUST
 *   set this explicitly — there is no implicit fallback.
 *
 * options.ttlSeconds — lock TTL in seconds. Defaults to 30.
 */
export async function withLock<T>(
  resource: string,
  fn: () => Promise<T>,
  options?: { failOpen?: boolean; ttlSeconds?: number },
): Promise<T> {
  const { failOpen = false, ttlSeconds = 30 } = options ?? {};
  const result = await acquireLockWithReason(resource, ttlSeconds);

  if (!result.acquired) {
    if (failOpen) {
      // Caller explicitly opted in to fail-open (non-critical operation)
      logger.warn("distributedLock.lock_unavailable_failopen", {
        resource,
        reason: result.reason,
        message: "Proceeding without lock (failOpen: true)",
      });
      return await fn();
    }

    // Fail-closed — distinguish "held" from "unavailable" so callers can
    // surface the right HTTP status code without string-matching messages.
    if (result.reason === "unavailable") {
      logger.error("distributedLock.redis_unavailable", {
        resource,
        message: "Redis unavailable — failing CLOSED.",
      });
      throw new AppError(
        "LOCK_UNAVAILABLE",
        "Service temporarily unavailable. Please try again in a moment.",
        503,
      );
    }

    // Lock held by another process
    logger.warn("distributedLock.lock_contention", {
      resource,
      message:
        "Lock held by another process — rejecting to prevent concurrent mutation.",
    });
    throw new AppError(
      "LOCK_CONTENTION",
      `Resource is being modified by another request. Please try again shortly.`,
      409,
    );
  }

  try {
    return await fn();
  } finally {
    await releaseLock(resource, result.value);
  }
}

/**
 * Acquire a lock, run fn() with a periodic heartbeat that extends the TTL,
 * then release the lock in a finally block.
 *
 * Use this instead of withLock when the locked operation may take longer than
 * ttlSeconds / 2 (e.g. operations that call Stripe under load).
 *
 * Heartbeat behaviour:
 *   - Fires every heartbeatIntervalSeconds (default: ttlSeconds / 3)
 *   - Reads the current lock value before extending — only extends if we still
 *     own the lock (compare-before-extend prevents extending a stolen lock)
 *   - Heartbeat failure is non-fatal: the TTL will expire naturally and another
 *     worker can take over
 *
 * The lock is always released in the finally block regardless of whether fn()
 * succeeds or throws. The heartbeat is always stopped in finally.
 *
 * Throws:
 *   LOCK_UNAVAILABLE (503) — Redis unavailable during acquisition
 *   LOCK_CONTENTION  (409) — lock held by another process
 */
export async function withLockAndHeartbeat<T>(
  resource: string,
  fn: () => Promise<T>,
  options: {
    ttlSeconds: number;
    heartbeatIntervalSeconds?: number;
  },
): Promise<T> {
  const { ttlSeconds } = options;
  const heartbeatIntervalSeconds =
    options.heartbeatIntervalSeconds ?? Math.floor(ttlSeconds / 3);

  const { getRedisClient } = await import("@/infrastructure/redis/client");
  const redis = getRedisClient();
  const lockValue = `lock:${randomUUID()}`;
  const key = `km:lock:${resource}`;

  // Acquire lock — SET NX EX (atomic)
  let acquired: string | null;
  try {
    acquired = await redis.set(key, lockValue, {
      nx: true,
      ex: ttlSeconds,
    });
  } catch {
    logger.error("distributedLock.redis_unavailable", {
      resource,
      message: "Redis unavailable — failing CLOSED.",
    });
    throw new AppError(
      "LOCK_UNAVAILABLE",
      "Service temporarily unavailable. Please try again in a moment.",
      503,
    );
  }

  if (!acquired) {
    logger.warn("distributedLock.lock_contention", {
      resource,
      message:
        "Lock held by another process — rejecting to prevent concurrent mutation.",
    });
    throw new AppError(
      "LOCK_CONTENTION",
      "Resource is being modified by another request. Please try again shortly.",
      409,
    );
  }

  // Heartbeat — extends the TTL every interval while the holder is still alive.
  // Stopped unconditionally in the finally block.
  let heartbeatActive = true;
  const heartbeatTimer = setInterval(() => {
    if (!heartbeatActive) return;
    void (async () => {
      try {
        // Compare-before-extend: only reset TTL if we still own the lock.
        // Guards against extending a lock that was released and re-acquired
        // by another worker during a very slow heartbeat cycle.
        const current = await redis.get(key);
        if (current === lockValue) {
          await redis.expire(key, ttlSeconds);
        } else {
          // Lock value mismatch — the lock is no longer ours.
          // This indicates the lock was lost to another worker and the current
          // operation may have been duplicated. Manual review recommended.
          logger.warn("distributedLock.heartbeat_lock_lost", {
            resource,
            message:
              "Lock value mismatch during heartbeat — lock was lost and " +
              "re-acquired by another worker. Operation may have been " +
              "duplicated. Manual review recommended.",
          });
        }
      } catch {
        // Non-fatal — let the TTL expire naturally if Redis is unreachable.
        logger.warn("distributedLock.heartbeat_failed", { resource });
      }
    })();
  }, heartbeatIntervalSeconds * 1000);

  try {
    return await fn();
  } finally {
    // Always stop the heartbeat and release the lock — even if fn() throws.
    heartbeatActive = false;
    clearInterval(heartbeatTimer);
    await releaseLock(resource, lockValue);
  }
}
