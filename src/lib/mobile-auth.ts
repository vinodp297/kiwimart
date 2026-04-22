// src/lib/mobile-auth.ts
// ─── Mobile JWT Auth ─────────────────────────────────────────────────────────
// Sign and verify JWTs for mobile clients using jose.
// Secret from MOBILE_JWT_SECRET env var. Tokens expire in 7 days.
// Each token carries a unique jti stored in Redis — deleted on logout.
// Session set (mobile:sessions:{userId}) tracks all active jtis for a user,
// enabling O(1) bulk revocation without a KEYS scan.

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getRedisClient } from "@/infrastructure/redis/client";
import { AppError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { MS_PER_WEEK, SECONDS_PER_WEEK } from "@/lib/time";

const getSecret = () => new TextEncoder().encode(process.env.MOBILE_JWT_SECRET);

// 7-day TTL balances security with UX — weekly re-authentication is acceptable
// for a marketplace mobile app. Shorter than 30 days to limit exposure if a
// token is compromised. The OpenAPI spec (api/docs/route.ts) must match this.
const EXPIRY = "7d";
const EXPIRY_MS = MS_PER_WEEK;
const EXPIRY_SECONDS = SECONDS_PER_WEEK; // TTL for Redis key
// Session set TTL is slightly longer than token TTL so revokeAll still works
// for tokens issued moments before the set would expire.
const SESSION_SET_TTL_SECONDS = EXPIRY_SECONDS + 3600; // 7 days + 1 hour

// ── Key helpers ───────────────────────────────────────────────────────────────

function tokenKey(userId: string, jti: string): string {
  return `mobile:token:${userId}:${jti}`;
}

/** Index set — members are jtis for all active sessions for a user. */
function sessionSetKey(userId: string): string {
  return `mobile:sessions:${userId}`;
}

// ── Payload type ──────────────────────────────────────────────────────────────

export interface MobileTokenPayload extends JWTPayload {
  sub: string;
  email: string;
  role: string;
  jti: string;
}

// ── pruneExpiredSessions ──────────────────────────────────────────────────────
// Removes stale jtis from the session index set after their token keys have
// expired naturally (via Redis TTL). Called best-effort from signMobileToken —
// never throws, never blocks token issuance.
//
// Only runs when the session set has more than 5 members to avoid overhead for
// normal users who have a small number of active sessions.

export async function pruneExpiredSessions(userId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const setKey = sessionSetKey(userId);
    const jtis = await redis.smembers(setKey);

    // Skip pruning for small sets — overhead not worth it for normal users.
    if (jtis.length <= 5) return;

    // Check which jtis have expired (token key no longer present in Redis).
    const checks = await Promise.all(
      jtis.map(async (jti: string) => ({
        jti,
        exists: (await redis.get(tokenKey(userId, jti))) !== null,
      })),
    );

    const stale = checks.filter((c) => !c.exists).map((c) => c.jti);

    if (stale.length === 0) return;

    // Atomically remove all stale jtis from the session set.
    await redis.srem(setKey, ...(stale as [string, ...string[]]));

    logger.info("mobile.session.pruned", {
      userId,
      pruned: stale.length,
    });
  } catch {
    // Best-effort — pruning failure must never block token issuance.
  }
}

// ── signMobileToken ───────────────────────────────────────────────────────────

export async function signMobileToken(
  user: { id: string; email: string; role: string },
  deviceHint = "unknown",
): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + EXPIRY_MS);
  const jti = crypto.randomUUID();

  const token = await new SignJWT({ email: user.email, role: user.role, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret());

  // Persist jti in Redis so it can be revoked on logout.
  // Also add jti to the session set so revokeAllMobileTokens can find it
  // without an O(N) KEYS scan.
  try {
    const redis = getRedisClient();
    await redis.set(
      tokenKey(user.id, jti),
      JSON.stringify({ issuedAt: new Date().toISOString(), deviceHint }),
      { ex: EXPIRY_SECONDS },
    );
    await redis.sadd(sessionSetKey(user.id), jti);
    await redis.expire(sessionSetKey(user.id), SESSION_SET_TTL_SECONDS);
  } catch {
    // Redis unavailable — token is still issued because the JWT signature
    // is the primary auth mechanism. Redis is only needed for revocation.
    // If Redis is down, tokens cannot be revoked until Redis recovers, but
    // they will expire naturally after 7 days. This is an acceptable
    // trade-off — fail-open on issue, fail-closed on verify (see below).
  }

  // Best-effort pruning of expired session set entries. Runs after the new
  // token is stored — never blocks issuance.
  void pruneExpiredSessions(user.id).catch(() => {});

  return { token, expiresAt: expiresAt.toISOString() };
}

// ── verifyMobileToken ─────────────────────────────────────────────────────────

export async function verifyMobileToken(
  token: string,
): Promise<MobileTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub || !payload.email || !payload.jti) return null;

    // Check Redis — if the jti key is gone the token has been revoked.
    // Fail-closed on Redis unavailability: we MUST NOT accept a token
    // whose revocation status cannot be confirmed. A compromised token
    // that was revoked (e.g. after password change) must not be accepted
    // for up to 7 days just because Redis is temporarily unavailable.
    // This is the intentional asymmetry with signMobileToken() which
    // fails open — issue is best-effort, verify is strict.
    // Returns 503 so the mobile client knows to retry, not re-login.
    try {
      const redis = getRedisClient();
      const stored = await redis.get(tokenKey(payload.sub, payload.jti));
      if (stored === null) return null; // revoked
    } catch (e) {
      if (e instanceof AppError) throw e;
      logger.error("mobile.auth.redis_unavailable", {
        jti: payload.jti as string,
      });
      throw AppError.authServiceUnavailable();
    }

    return payload as MobileTokenPayload;
  } catch (e) {
    // Re-throw AppErrors (e.g. AUTH_SERVICE_UNAVAILABLE) so callers can return
    // the correct HTTP status instead of falling through to a generic 401.
    if (e instanceof AppError) throw e;
    return null;
  }
}

// ── revokeMobileToken ─────────────────────────────────────────────────────────
// Call on single-device logout.

export async function revokeMobileToken(
  userId: string,
  jti: string,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(tokenKey(userId, jti));
    await redis.srem(sessionSetKey(userId), jti);
  } catch {
    // Best-effort — log in caller if needed
  }
}

// ── revokeAllMobileTokens ─────────────────────────────────────────────────────
// Call on password change or account-compromise flows.
// Uses the session set index to find all jtis in O(1) — no KEYS scan.

export async function revokeAllMobileTokens(userId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const jtis = await redis.smembers(sessionSetKey(userId));
    if (jtis.length > 0) {
      const tokenKeys = jtis.map((jti: string) => tokenKey(userId, jti));
      await redis.del(...(tokenKeys as [string, ...string[]]));
    }
    await redis.del(sessionSetKey(userId));
  } catch {
    // Best-effort
  }
}
