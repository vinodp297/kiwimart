// src/app/api/v1/auth/logout/route.ts
// ─── Mobile Logout ────────────────────────────────────────────────────────────
// POST /api/v1/auth/logout — revoke the current device's JWT jti from Redis.

import { revokeMobileToken, verifyMobileToken } from "@/lib/mobile-auth";
import { requireApiUser } from "../../_helpers/response";
import { apiOk, apiError } from "../../_helpers/response";
import { corsHeaders, withCors } from "../../_helpers/cors";
import { logger } from "@/shared/logger";

export async function POST(request: Request) {
  try {
    // 1. Require Bearer token — session-cookie callers don't have a jti to revoke
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return withCors(apiError("Missing Bearer token", 401, "MISSING_TOKEN"));
    }

    const token = authHeader.slice(7);

    // 2. Verify signature and extract payload (includes jti)
    const payload = await verifyMobileToken(token);
    if (!payload?.sub || !payload.jti) {
      return withCors(
        apiError("Invalid or expired token", 401, "INVALID_TOKEN"),
      );
    }

    // 3. Confirm the requester is a valid, non-banned user
    await requireApiUser(request);

    // 4. Revoke the token's jti in Redis
    await revokeMobileToken(payload.sub, payload.jti);

    logger.info("mobile.token.revoked", { userId: payload.sub });

    return withCors(apiOk({ message: "Logged out successfully" }));
  } catch (e) {
    logger.error("api.error", {
      path: "/api/v1/auth/logout",
      error: e instanceof Error ? e.message : e,
    });
    return withCors(apiError("Logout failed. Please try again.", 500));
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
