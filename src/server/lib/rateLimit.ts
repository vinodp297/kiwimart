// src/server/lib/rateLimit.ts
// ─── Rate Limiting — Upstash Redis Sliding Window ────────────────────────────
// Uses @upstash/ratelimit with Redis for distributed rate limiting.
// Works on both Vercel Edge and Node.js runtimes.
//
// All sensitive server actions (login, register, password reset, offer creation,
// message sending) call rateLimit() before executing business logic.
//
// Limits are keyed by IP address extracted from Next.js request headers.
// In Sprint 4 — authenticated endpoints will additionally key by userId.

import { Ratelimit } from "@upstash/ratelimit";
import { getRedisClient } from "@/infrastructure/redis/client";

// ── Rate limit configurations ─────────────────────────────────────────────────

/** 5 attempts per 15 minutes — login, password reset request */
const authLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(5, "15 m"),
    prefix: "km:rl:auth",
    analytics: true,
  });

/** 3 registrations per hour per IP */
const registerLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(3, "1 h"),
    prefix: "km:rl:register",
    analytics: true,
  });

/** 20 messages per minute — prevent spam */
const messageLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(20, "1 m"),
    prefix: "km:rl:message",
    analytics: true,
  });

/** 10 listings per hour per user */
const listingLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(10, "1 h"),
    prefix: "km:rl:listing",
    analytics: true,
  });

/** 5 offers per 10 minutes */
const offerLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(5, "10 m"),
    prefix: "km:rl:offer",
    analytics: true,
  });

/** 5 orders per hour per user — prevent checkout abuse */
const orderLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(5, "1 h"),
    prefix: "km:rl:order",
    analytics: true,
  });

/** 3 disputes per day per user — prevent abuse of the dispute system */
const disputeLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(3, "1 d"),
    prefix: "km:rl:disputes",
    analytics: true,
  });

/** 20 cart actions per minute per user — prevent cart abuse */
const cartLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(20, "1 m"),
    prefix: "km:rl:cart",
    analytics: true,
  });

/** 10 reviews per hour per user — prevent review spam */
const reviewLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(10, "1 h"),
    prefix: "km:rl:review",
    analytics: true,
  });

/** 60 watchlist toggles per hour per user — generous for browsing, prevents bot abuse */
const watchLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(60, "1 h"),
    prefix: "km:rl:watch",
    analytics: true,
  });

/** 10 offer responses per hour per user — accept/decline actions */
const offerRespondLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(10, "1 h"),
    prefix: "km:rl:offer-respond",
    analytics: true,
  });

/** 10 profile updates per hour per user */
const accountUpdateLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(10, "1 h"),
    prefix: "km:rl:account-update",
    analytics: true,
  });

/** 5 push token registrations per hour per user — device registration */
const pushTokenLimiter = () =>
  new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(5, "1 h"),
    prefix: "km:rl:push-token",
    analytics: true,
  });

// ── Rate limit types ──────────────────────────────────────────────────────────

export type RateLimitKey =
  | "auth"
  | "register"
  | "message"
  | "listing"
  | "offer"
  | "order"
  | "disputes"
  | "cart"
  | "review"
  | "watch"
  | "offerRespond"
  | "accountUpdate"
  | "pushToken";

export interface RateLimitResult {
  success: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Unix timestamp (ms) when the limit resets */
  reset: number;
  /** Retry-After seconds */
  retryAfter: number;
}

/**
 * Check rate limit for a given key and identifier.
 * Call at the top of every sensitive server action.
 *
 * @example
 * const limit = await rateLimit('auth', ip);
 * if (!limit.success) {
 *   return { success: false, error: 'Too many attempts. Try again in a few minutes.' };
 * }
 */
export async function rateLimit(
  type: RateLimitKey,
  identifier: string,
): Promise<RateLimitResult> {
  // In development / test — skip rate limiting when Redis isn't configured.
  // Also skip when URL is a placeholder (same pattern as PostHog guard).
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? "";
  const redisConfigured =
    redisUrl.length > 0 && !redisUrl.includes("placeholder");
  if (process.env.NODE_ENV === "development" && !redisConfigured) {
    return {
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    };
  }

  const limiterFactories: Record<RateLimitKey, () => Ratelimit> = {
    auth: authLimiter,
    register: registerLimiter,
    message: messageLimiter,
    listing: listingLimiter,
    offer: offerLimiter,
    order: orderLimiter,
    disputes: disputeLimiter,
    cart: cartLimiter,
    review: reviewLimiter,
    watch: watchLimiter,
    offerRespond: offerRespondLimiter,
    accountUpdate: accountUpdateLimiter,
    pushToken: pushTokenLimiter,
  };

  const limiter = limiterFactories[type]();
  const result = await limiter.limit(identifier);

  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
    retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
  };
}

/**
 * Extract client IP from Next.js request headers.
 *
 * Priority order (most trusted → least trusted):
 *   1. x-real-ip — set by Vercel infrastructure, cannot be spoofed by clients
 *   2. cf-connecting-ip — set by Cloudflare, cannot be spoofed behind CF proxy
 *   3. x-vercel-forwarded-for — Vercel-specific, more reliable than generic
 *
 * SECURITY: We intentionally do NOT fall back to x-forwarded-for because
 * clients can inject arbitrary values. On Vercel and Cloudflare, the
 * platform-specific headers are always set and trustworthy.
 */
export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-real-ip") ?? // Vercel (most trusted — set by infra)
    headers.get("cf-connecting-ip") ?? // Cloudflare (set by edge, not spoofable)
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? // Vercel forwarded
    "unknown"
  );
}
