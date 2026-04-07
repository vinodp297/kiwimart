// src/app/api/v1/auth/refresh/route.ts
// ─── Mobile Token Refresh ────────────────────────────────────────────────────
// POST /api/v1/auth/refresh — verify existing Bearer token, issue a fresh one.

import { verifyMobileToken, signMobileToken } from "@/lib/mobile-auth";
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

    const { token: newToken, expiresAt } = await signMobileToken({
      id: payload.sub,
      email: payload.email as string,
      role: (payload.role as string) ?? "user",
    });

    logger.info("mobile.token.refreshed", { userId: payload.sub });

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
