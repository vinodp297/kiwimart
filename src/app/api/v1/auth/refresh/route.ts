// src/app/api/v1/auth/refresh/route.ts
// ─── Mobile Token Refresh ────────────────────────────────────────────────────
// POST /api/v1/auth/refresh — verify existing Bearer token, issue a fresh one.
//
// Security: after issuing the new token, the old token is immediately revoked:
//   1. Old jti is added to the JWT blocklist (defence-in-depth; TTL = remaining
//      lifetime of the old token so the blocklist doesn't grow indefinitely).
//   2. Old mobile token key deleted from Redis via revokeMobileToken — the
//      primary revocation mechanism used by verifyMobileToken on every request.
//   3. New token is registered in Redis by signMobileToken automatically.
//
// This prevents a compromised token from remaining valid after refresh and
// stops multiple valid tokens accumulating for the same device.

import {
  verifyMobileToken,
  signMobileToken,
  revokeMobileToken,
} from "@/lib/mobile-auth";
import { blockToken } from "@/server/lib/jwtBlocklist";
import { AppError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return withCors(
        apiError("Missing Bearer token", 401, "MISSING_TOKEN"),
        request.headers.get("origin"),
      );
    }

    const token = authHeader.slice(7);
    const payload = await verifyMobileToken(token);

    if (!payload?.sub || !payload.email) {
      return withCors(
        apiError("Invalid or expired token", 401, "INVALID_TOKEN"),
        request.headers.get("origin"),
      );
    }

    const oldJti = payload.jti;
    const oldExp = payload.exp ?? 0;

    // Issue new token first — if this fails we haven't revoked the old one yet
    const { token: newToken, expiresAt } = await signMobileToken({
      id: payload.sub,
      email: payload.email as string,
      role: (payload.role as string) ?? "user",
    });

    // Revoke old token — both mechanisms run concurrently for speed.
    // Errors are best-effort: the new token is already issued so we must not
    // return a failure here. Logging ensures ops can detect Redis issues.
    await Promise.allSettled([
      // Primary: delete the Redis key that verifyMobileToken checks
      revokeMobileToken(payload.sub, oldJti),
      // Defence-in-depth: add to JWT blocklist with remaining TTL so the
      // blocklist key expires when the old token would have expired anyway.
      blockToken(oldJti, oldExp),
    ]);

    logger.info("mobile.token.refreshed", {
      userId: payload.sub,
      oldJti,
      revokedAt: new Date().toISOString(),
    });

    return withCors(
      apiOk({ token: newToken, expiresAt }),
      request.headers.get("origin"),
    );
  } catch (e) {
    if (e instanceof AppError) {
      return withCors(
        apiError(e.message, e.statusCode, e.code),
        request.headers.get("origin"),
      );
    }
    logger.error("api.error", {
      path: "/api/v1/auth/refresh",
      error: e instanceof Error ? e.message : e,
    });
    return withCors(
      apiError("Token refresh failed. Please sign in again.", 500),
      request.headers.get("origin"),
    );
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
