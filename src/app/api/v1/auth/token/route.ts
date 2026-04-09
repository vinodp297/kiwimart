// src/app/api/v1/auth/token/route.ts
// ─── Mobile Token Endpoint ───────────────────────────────────────────────────
// POST /api/v1/auth/token — exchange email+password for a 30-day Bearer token.

import { userRepository } from "@/modules/users/user.repository";
import { verifyPassword } from "@/server/lib/password";
import { signMobileToken } from "@/lib/mobile-auth";
import { tokenRequestSchema } from "@/modules/auth/auth.schema";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";

// Dummy hash for timing-safe comparison when user not found
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";

export async function POST(request: Request) {
  try {
    // 1. Rate limit
    const ip = getClientIp(new Headers(request.headers));
    const limitResult = await rateLimit("auth", ip || "unknown");
    if (!limitResult.success) {
      return withCors(
        apiError(
          `Too many login attempts. Try again in ${limitResult.retryAfter} seconds.`,
          429,
        ),
        request.headers.get("origin"),
      );
    }

    // 2. Parse body
    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const parsed = tokenRequestSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(
        apiError("Invalid email or password format", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const { email, password } = parsed.data;

    // 3. Look up user — timing-safe: always hash even if user doesn't exist
    const user = await userRepository.findForMobileAuth(email);

    const hashToVerify = user?.passwordHash ?? DUMMY_HASH;
    const passwordValid = await verifyPassword(hashToVerify, password);

    if (!user || !passwordValid) {
      audit({
        userId: user?.id ?? null,
        action: "USER_LOGIN",
        metadata: {
          success: false,
          reason: "invalid_credentials",
          channel: "mobile",
        },
      });
      return withCors(
        apiError("Invalid credentials", 401, "INVALID_CREDENTIALS"),
        request.headers.get("origin"),
      );
    }

    // 4. Check bans
    if (user.isBanned) {
      audit({
        userId: user.id,
        action: "USER_LOGIN",
        metadata: { success: false, reason: "banned", channel: "mobile" },
      });
      return withCors(
        apiError("Account is suspended", 403, "ACCOUNT_BANNED"),
        request.headers.get("origin"),
      );
    }

    // 5. Issue token
    const role = user.isAdmin ? "admin" : "user";
    const { token, expiresAt } = await signMobileToken({
      id: user.id,
      email: user.email,
      role,
    });

    audit({
      userId: user.id,
      action: "USER_LOGIN",
      metadata: { success: true, channel: "mobile" },
    });

    logger.info("mobile.token.issued", { userId: user.id });

    return withCors(
      apiOk({
        token,
        expiresAt,
        user: { id: user.id, email: user.email, role },
      }),
      request.headers.get("origin"),
    );
  } catch (e) {
    logger.error("api.error", {
      path: "/api/v1/auth/token",
      error: e instanceof Error ? e.message : e,
    });
    return withCors(
      apiError("Authentication failed. Please try again.", 500),
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
