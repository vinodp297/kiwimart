// src/app/api/v1/auth/token/route.ts
// ─── Mobile Token Endpoint ───────────────────────────────────────────────────
// POST /api/v1/auth/token — exchange email+password for a 30-day Bearer token.

import db from "@/lib/db";
import { verifyPassword } from "@/server/lib/password";
import { signMobileToken } from "@/lib/mobile-auth";
import { tokenRequestSchema } from "@/modules/auth/auth.schema";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "../../_helpers/response";
import { corsHeaders } from "../../_helpers/cors";

// Dummy hash for timing-safe comparison when user not found
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";

export async function POST(request: Request) {
  try {
    // 1. Rate limit
    const ip = getClientIp(new Headers(request.headers));
    const limitResult = await rateLimit("auth", ip || "unknown");
    if (!limitResult.success) {
      return apiError(
        `Too many login attempts. Try again in ${limitResult.retryAfter} seconds.`,
        429,
      );
    }

    // 2. Parse body
    const body = await request.json().catch(() => null);
    if (!body) {
      return apiError("Invalid request body", 400, "VALIDATION_ERROR");
    }

    const parsed = tokenRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "Invalid email or password format",
        400,
        "VALIDATION_ERROR",
      );
    }

    const { email, password } = parsed.data;

    // 3. Look up user — timing-safe: always hash even if user doesn't exist
    const user = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isAdmin: true,
        isBanned: true,
        displayName: true,
      },
    });

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
      return apiError("Invalid credentials", 401, "INVALID_CREDENTIALS");
    }

    // 4. Check bans
    if (user.isBanned) {
      audit({
        userId: user.id,
        action: "USER_LOGIN",
        metadata: { success: false, reason: "banned", channel: "mobile" },
      });
      return apiError("Account is suspended", 403, "ACCOUNT_BANNED");
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

    return apiOk({
      token,
      expiresAt,
      user: { id: user.id, email: user.email, role },
    });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/v1/auth/token",
      error: e instanceof Error ? e.message : e,
    });
    return apiError("Authentication failed. Please try again.", 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
