// src/infrastructure/stripe/circuit-breaker.ts
// ─── Stripe Circuit Breaker ───────────────────────────────────────────────────
// Prevents retry storms during Stripe regional outages by tracking consecutive
// failures and temporarily rejecting calls when the failure threshold is reached.
//
// State machine:
//   CLOSED    — normal operation. Opens after FAILURE_THRESHOLD consecutive failures.
//   OPEN      — rejects immediately without calling Stripe. Transitions to
//               HALF-OPEN after RECOVERY_TIMEOUT_MS to allow probe requests.
//   HALF-OPEN — executes one probe. Closes after SUCCESS_THRESHOLD consecutive
//               successes; re-opens immediately on any failure.
//
// Circuit breaker state is stored in Redis so it is shared across all serverless
// instances — a Stripe outage detected by one instance protects all others.
//
// Fails open if Redis itself is unavailable — Stripe calls are never blocked
// solely because the circuit breaker's own storage is unreachable.

import { getRedisClient } from "@/infrastructure/redis/client";
import { AppError } from "@/shared/errors";
import { logger } from "@/shared/logger";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of consecutive failures before the circuit opens. */
export const FAILURE_THRESHOLD = 5;

/** Milliseconds to wait in OPEN state before allowing a half-open probe. */
export const RECOVERY_TIMEOUT_MS = 60_000;

/** Consecutive successes required in HALF-OPEN state to close the circuit. */
export const SUCCESS_THRESHOLD = 2;

/** Failure counter TTL in seconds — resets automatically if no failures for 2 minutes. */
export const FAILURE_TTL_SECONDS = 120;

// ── Redis keys ────────────────────────────────────────────────────────────────

export const KEYS = {
  state: "stripe:circuit:state",
  failures: "stripe:circuit:failures",
  lastFailure: "stripe:circuit:last-failure",
  successes: "stripe:circuit:successes",
} as const;

type CircuitState = "closed" | "open" | "half-open";

// ── State resolution ──────────────────────────────────────────────────────────

/**
 * Reads circuit state from Redis and handles the OPEN → HALF-OPEN timed
 * transition inline. Throws if Redis is unavailable (callers handle this).
 */
async function resolveState(): Promise<{
  redis: ReturnType<typeof getRedisClient>;
  state: CircuitState;
}> {
  const redis = getRedisClient();
  const stored = await redis.get<string>(KEYS.state);

  // null or "closed" → circuit is closed (healthy)
  if (!stored || stored === "closed") {
    return { redis, state: "closed" };
  }

  if (stored === "half-open") {
    return { redis, state: "half-open" };
  }

  // "open" — check whether the recovery timeout has elapsed
  if (stored === "open") {
    const lastFailure = await redis.get<string>(KEYS.lastFailure);
    if (lastFailure) {
      const elapsed = Date.now() - new Date(lastFailure).getTime();
      if (elapsed >= RECOVERY_TIMEOUT_MS) {
        // Transition to HALF-OPEN so a probe request can test Stripe
        await redis.set(KEYS.state, "half-open");
        await redis.del(KEYS.successes); // reset success counter for new probe window
        return { redis, state: "half-open" };
      }
    }
    return { redis, state: "open" };
  }

  // Unrecognised stored value — treat as closed (safe default)
  return { redis, state: "closed" };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Wraps a Stripe API call with circuit breaker protection.
 *
 * @param fn            — the Stripe operation to execute
 * @param operationName — descriptive name used in log events (e.g. "transfers.create")
 */
export async function withStripeCircuitBreaker<T>(
  fn: () => Promise<T>,
  operationName: string,
): Promise<T> {
  let redis: ReturnType<typeof getRedisClient>;
  let state: CircuitState;

  try {
    const resolved = await resolveState();
    redis = resolved.redis;
    state = resolved.state;
  } catch {
    // Redis unavailable — fail open for the circuit breaker itself.
    // Payment processing must never be blocked because circuit state cannot be read.
    logger.warn("stripe.circuit_breaker.redis_unavailable");
    return fn();
  }

  // ── OPEN: reject immediately, do not touch Stripe ────────────────────────

  if (state === "open") {
    logger.info("stripe.circuit.rejected", { operationName, state: "open" });
    throw new AppError(
      "PAYMENT_GATEWAY_UNAVAILABLE",
      "Payment service temporarily unavailable. Please try again shortly.",
      503,
    );
  }

  // ── HALF-OPEN: log that we are probing Stripe ────────────────────────────

  if (state === "half-open") {
    logger.info("stripe.circuit.half_open", { operationName });
  }

  // ── CLOSED or HALF-OPEN: execute the Stripe call ─────────────────────────

  try {
    const result = await fn();

    // Success — attempt to update state (best-effort; never throw)
    if (state === "half-open") {
      try {
        const successes = await redis.incr(KEYS.successes);
        if (successes >= SUCCESS_THRESHOLD) {
          await redis.set(KEYS.state, "closed");
          await redis.del(KEYS.failures);
          await redis.del(KEYS.lastFailure);
          await redis.del(KEYS.successes);
          logger.info("stripe.circuit.closed", { operationName });
        }
      } catch {
        // Best-effort — don't prevent a successful call from returning
      }
    }

    return result;
  } catch (err) {
    // Failure — attempt to update state (best-effort; always re-throw)
    try {
      if (state === "half-open") {
        // Any failure in HALF-OPEN immediately re-opens the circuit
        await redis.set(KEYS.state, "open");
        await redis.set(KEYS.lastFailure, new Date().toISOString());
        await redis.del(KEYS.successes);
        logger.warn("stripe.circuit.opened", {
          failures: FAILURE_THRESHOLD,
          operationName,
        });
      } else {
        // CLOSED: increment the failure counter with a rolling TTL
        const failures = await redis.incr(KEYS.failures);
        await redis.expire(KEYS.failures, FAILURE_TTL_SECONDS);
        await redis.set(KEYS.lastFailure, new Date().toISOString());
        if (failures >= FAILURE_THRESHOLD) {
          await redis.set(KEYS.state, "open");
          logger.warn("stripe.circuit.opened", { failures, operationName });
        }
      }
    } catch {
      // Best-effort — failure tracking must never suppress the original error
    }

    throw err;
  }
}
