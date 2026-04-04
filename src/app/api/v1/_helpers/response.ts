// src/app/api/v1/_helpers/response.ts
// ─── API Response Helpers ────────────────────────────────────────────────────

import { AppError } from "@/shared/errors";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { verifyMobileToken } from "@/lib/mobile-auth";
import {
  rateLimit,
  getClientIp,
  type RateLimitKey,
} from "@/server/lib/rateLimit";

export function apiOk<T>(data: T, status = 200): Response {
  return Response.json(
    {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export function apiError(
  message: string,
  status: number,
  code?: string,
): Response {
  return Response.json(
    {
      success: false,
      error: message,
      code,
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export function handleApiError(e: unknown): Response {
  if (e instanceof AppError) {
    return apiError(e.message, e.statusCode, e.code);
  }
  return apiError(
    "An unexpected error occurred. Please try again or contact support.",
    500,
  );
}

const USER_SELECT = {
  id: true,
  email: true,
  isAdmin: true,
  isBanned: true,
  sellerEnabled: true,
  stripeOnboarded: true,
} as const;

export async function requireApiUser(request?: Request) {
  // 1. Try Authorization header first (mobile clients)
  if (request) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = await verifyMobileToken(token);
      if (!payload?.sub) {
        throw AppError.unauthenticated();
      }

      const user = await db.user.findUnique({
        where: { id: payload.sub, deletedAt: null },
        select: USER_SELECT,
      });
      if (!user) throw AppError.unauthenticated();
      if (user.isBanned) throw AppError.banned();
      return user;
    }
  }

  // 2. Fall back to session cookie (web clients)
  const session = await auth();
  if (!session?.user?.id) {
    throw AppError.unauthenticated();
  }

  // Fresh DB lookup — same pattern as requireUser().
  // Session tokens may be stale: soft-deleted or banned users must be rejected.
  const user = await db.user.findUnique({
    where: {
      id: session.user.id,
      deletedAt: null, // Reject soft-deleted accounts
    },
    select: USER_SELECT,
  });

  if (!user) {
    throw AppError.unauthenticated();
  }

  if (user.isBanned) {
    throw AppError.banned();
  }

  return user;
}

/**
 * Apply rate limiting to an API endpoint.
 * Returns a 429 Response if rate-limited, or null if allowed.
 */
export async function checkApiRateLimit(
  request: Request,
  type: RateLimitKey,
): Promise<Response | null> {
  const ip = getClientIp(new Headers(request.headers));
  const result = await rateLimit(type, `api:${ip}`);

  if (!result.success) {
    return Response.json(
      {
        success: false,
        error: "Too many requests",
        retryAfter: result.retryAfter,
        timestamp: new Date().toISOString(),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfter),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(result.reset),
        },
      },
    );
  }

  return null; // Allowed — proceed
}
