// src/app/api/v1/me/erase/confirm/route.ts
// ─── Account Erasure Confirmation — NZ Privacy Act 2020 ──────────────────────
// GET /api/v1/me/erase/confirm?token=<hex>
//   Step 2 of 2-step email-confirmation erasure flow.
//   Verifies the one-time token stored in Redis, performs the erasure,
//   then redirects the browser to /?erased=true.
//
//   The token is single-use — deleted immediately after consumption.

import { NextResponse } from "next/server";
import { getRedisClient } from "@/infrastructure/redis/client";
import { performAccountErasure } from "@/modules/users/erasure.service";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token || token.length === 0) {
    return NextResponse.redirect(new URL("/?erased=invalid", request.url));
  }

  const redisKey = `erasure:token:${token}`;
  let userId: string;

  try {
    const redis = getRedisClient();
    const raw = await redis.get<string>(redisKey);

    if (!raw) {
      logger.warn("erasure.confirm.token_not_found", {
        token: token.slice(0, 8),
      });
      return NextResponse.redirect(new URL("/?erased=invalid", request.url));
    }

    const parsed =
      typeof raw === "string"
        ? (JSON.parse(raw) as { userId: string })
        : (raw as { userId: string });
    userId = parsed.userId;

    if (!userId) {
      logger.warn("erasure.confirm.malformed_token", {
        token: token.slice(0, 8),
      });
      return NextResponse.redirect(new URL("/?erased=invalid", request.url));
    }

    // Consume the token immediately — prevents replay attacks
    await redis.del(redisKey);
  } catch (redisErr) {
    logger.error("erasure.confirm.redis_error", {
      error: redisErr instanceof Error ? redisErr.message : String(redisErr),
    });
    return NextResponse.redirect(new URL("/?erased=error", request.url));
  }

  try {
    await performAccountErasure({ userId, operatorId: "self-service" });
    logger.info("erasure.confirm.completed", { userId });
  } catch (erasureErr) {
    logger.error("erasure.confirm.erasure_failed", {
      userId,
      error:
        erasureErr instanceof Error ? erasureErr.message : String(erasureErr),
    });
    return NextResponse.redirect(new URL("/?erased=error", request.url));
  }

  return NextResponse.redirect(new URL("/?erased=true", request.url));
}
