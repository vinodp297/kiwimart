// src/lib/mobile-auth.ts
// ─── Mobile JWT Auth ─────────────────────────────────────────────────────────
// Sign and verify JWTs for mobile clients using jose.
// Secret from MOBILE_JWT_SECRET env var. Tokens expire in 30 days.
// Each token carries a unique jti stored in Redis — deleted on logout.

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getRedisClient } from "@/infrastructure/redis/client";

const getSecret = () => new TextEncoder().encode(process.env.MOBILE_JWT_SECRET);

const EXPIRY = "30d";
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const EXPIRY_SECONDS = 30 * 24 * 60 * 60; // TTL for Redis key

// ── Token key helpers ─────────────────────────────────────────────────────────

function tokenKey(userId: string, jti: string): string {
  return `mobile:token:${userId}:${jti}`;
}

// ── Payload type ──────────────────────────────────────────────────────────────

export interface MobileTokenPayload extends JWTPayload {
  sub: string;
  email: string;
  role: string;
  jti: string;
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

  // Persist jti in Redis so it can be revoked on logout
  try {
    const redis = getRedisClient();
    await redis.set(
      tokenKey(user.id, jti),
      JSON.stringify({ issuedAt: new Date().toISOString(), deviceHint }),
      { ex: EXPIRY_SECONDS },
    );
  } catch {
    // Redis unavailable — token still issued; revocation will fail-open
    // (acceptable: token expiry is the fallback)
  }

  return { token, expiresAt: expiresAt.toISOString() };
}

// ── verifyMobileToken ─────────────────────────────────────────────────────────

export async function verifyMobileToken(
  token: string,
): Promise<MobileTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub || !payload.email || !payload.jti) return null;

    // Check Redis — if the jti key is gone the token has been revoked
    try {
      const redis = getRedisClient();
      const stored = await redis.get(tokenKey(payload.sub, payload.jti));
      if (stored === null) return null; // revoked
    } catch {
      // Redis unavailable — fail-open: accept token (expiry is the fallback)
    }

    return payload as MobileTokenPayload;
  } catch {
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
  } catch {
    // Best-effort — log in caller if needed
  }
}

// ── revokeAllMobileTokens ─────────────────────────────────────────────────────
// Call on password change or account-compromise flows.

export async function revokeAllMobileTokens(userId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const pattern = `mobile:token:${userId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...(keys as [string, ...string[]]));
    }
  } catch {
    // Best-effort
  }
}
