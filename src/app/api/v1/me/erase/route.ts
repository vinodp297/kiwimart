// src/app/api/v1/me/erase/route.ts
// ─── Account Erasure Request — NZ Privacy Act 2020 ───────────────────────────
// POST /api/v1/me/erase
//   Step 1 of 2-step email-confirmation erasure flow.
//   Generates a secure token, stores it in Redis (24-hour TTL),
//   and sends a confirmation email with a link to /api/v1/me/erase/confirm.
//   The actual erasure does NOT happen until the link is clicked.
//
// Rate limited: 3 requests per hour per user (keyed by user ID).

import { randomBytes } from "crypto";
import { requireApiUser, apiOk, apiError } from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";
import { handleRouteError } from "@/server/lib/handle-route-error";
import { getRedisClient } from "@/infrastructure/redis/client";
import { enqueueEmail } from "@/lib/email-queue";
import { rateLimit } from "@/server/lib/rateLimit";
import { orderRepository } from "@/modules/orders/order.repository";
import { userRepository } from "@/modules/users/user.repository";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

const TOKEN_TTL_SECONDS = 86_400; // 24 hours

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  try {
    const user = await requireApiUser(request);

    // Rate limit: 3 erasure-request emails per hour per user
    try {
      const limit = await rateLimit(
        "accountDelete",
        `erasure-request:${user.id}`,
      );
      if (!limit.success) {
        return withCors(
          apiError(
            "Too many requests. Please wait before requesting again.",
            429,
            "RATE_LIMITED",
          ),
          origin,
        );
      }
    } catch (rlErr) {
      logger.warn("erasure-request:rate-limit-unavailable", {
        userId: user.id,
        error: rlErr instanceof Error ? rlErr.message : String(rlErr),
      });
      // Fail open — right to erasure must not be blocked by Redis outage
    }

    // Pre-flight: reject if user has active orders in escrow
    const activeOrderCount = await orderRepository.countActiveOrdersForUser(
      user.id,
    );
    if (activeOrderCount > 0) {
      return withCors(
        apiError(
          `Cannot request account deletion with ${activeOrderCount} active order(s). Resolve all active orders first.`,
          409,
          "ERASURE_BLOCKED",
        ),
        origin,
      );
    }

    // Look up user details for the email
    const userRecord = await userRepository.findEmailInfo(user.id);
    if (!userRecord) {
      return withCors(apiError("User not found.", 404, "NOT_FOUND"), origin);
    }

    // Generate a cryptographically secure token
    const token = randomBytes(32).toString("hex");

    // Store token → userId in Redis with 24-hour TTL
    const redis = getRedisClient();
    await redis.set(
      `erasure:token:${token}`,
      JSON.stringify({ userId: user.id }),
      { ex: TOKEN_TTL_SECONDS },
    );

    // Build the confirmation URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const confirmUrl = `${appUrl}/api/v1/me/erase/confirm?token=${token}`;

    // Send the confirmation email (queued asynchronously)
    await enqueueEmail({
      template: "erasureRequest",
      to: userRecord.email,
      displayName: userRecord.displayName ?? "there",
      confirmUrl,
    });

    logger.info("erasure.request.sent", { userId: user.id });

    return withCors(
      apiOk({
        message:
          "A confirmation email has been sent. Please check your inbox and click the link to complete account deletion.",
      }),
      origin,
    );
  } catch (e) {
    return withCors(
      handleRouteError(e, { path: "POST /api/v1/me/erase" }),
      origin,
    );
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
