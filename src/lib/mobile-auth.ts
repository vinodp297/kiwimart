// src/lib/mobile-auth.ts
// ─── Mobile JWT Auth ─────────────────────────────────────────────────────────
// Sign and verify JWTs for mobile clients using jose.
// Secret from MOBILE_JWT_SECRET env var. Tokens expire in 30 days.

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const getSecret = () => new TextEncoder().encode(process.env.MOBILE_JWT_SECRET);

const EXPIRY = "30d";
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export interface MobileTokenPayload extends JWTPayload {
  sub: string;
  email: string;
  role: string;
}

export async function signMobileToken(user: {
  id: string;
  email: string;
  role: string;
}): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + EXPIRY_MS);
  const token = await new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret());
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function verifyMobileToken(
  token: string,
): Promise<MobileTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub || !payload.email) return null;
    return payload as MobileTokenPayload;
  } catch {
    return null;
  }
}
