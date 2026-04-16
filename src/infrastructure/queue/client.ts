// src/infrastructure/queue/client.ts
// ─── IORedis Connection for BullMQ ───────────────────────────────────────────
// Single ioredis connection used by all BullMQ queues and workers.
// (This is separate from @upstash/redis — BullMQ requires native TCP Redis)

import IORedis from "ioredis";
import { logger } from "@/shared/logger";
import { env } from "@/env";

let _connection: IORedis | null = null;

/**
 * IORedis retry strategy — retries indefinitely with capped exponential backoff.
 *
 * A 10-second Redis blip must NOT kill the worker permanently. Returning null
 * from retryStrategy terminates the connection for good; we never do that.
 *
 * Backoff schedule:
 *   attempt 1 →  200 ms
 *   attempt 2 →  400 ms
 *   attempt 5 → 1000 ms
 *   attempt 10+ → 5000 ms (cap — never grows beyond 5 seconds)
 *
 * Exported for unit testing.
 */
export function queueRetryStrategy(times: number): number {
  const delay = Math.min(times * 200, 5000);
  logger.warn("redis.reconnecting", { attempt: times, delayMs: delay });
  return delay;
}

export function getQueueConnection(): IORedis {
  if (_connection) return _connection;

  const redisUrl = env.REDIS_URL;

  if (redisUrl.includes("PLACEHOLDER") || redisUrl.includes("placeholder")) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "REDIS_URL is required in production. " +
          "Configure a real Upstash Redis URL.",
      );
    }
    // Development fallback — local Redis
    _connection = new IORedis({
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: queueRetryStrategy,
    });
    return _connection;
  }

  _connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: redisUrl.startsWith("rediss://") ? {} : undefined,
    retryStrategy: queueRetryStrategy,
  });

  _connection.on("error", (err) => {
    logger.error("queue:connection-error", {
      error: err.message,
      stack: env.NODE_ENV !== "production" ? err.stack : undefined,
    });
  });

  _connection.on("close", () => {
    logger.warn("queue:connection-closed");
  });

  _connection.on("reconnecting", () => {
    logger.warn("queue:reconnecting");
  });

  return _connection;
}
