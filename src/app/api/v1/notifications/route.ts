// src/app/api/v1/notifications/route.ts
// GET  /api/v1/notifications  — cursor-paginated notifications for NavBar / full list
// PATCH /api/v1/notifications — mark all as read

import { z } from "zod";
import { AppError } from "@/shared/errors";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import { notificationsQuerySchema } from "@/modules/notifications/notification.schema";
import { rateLimit } from "@/server/lib/rateLimit";
import { handleRouteError } from "@/server/lib/handle-route-error";
import { apiOk, apiError, requireApiUser } from "../_helpers/response";
import { getCorsHeaders, withCors } from "../_helpers/cors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // Use requireApiUser for consistency with other v1 routes — supports both
    // mobile Bearer tokens and web session cookies, performs ban checks, and
    // throws AppError.unauthenticated() so handleRouteError can map to 401.
    let user;
    try {
      user = await requireApiUser(request);
    } catch (authErr) {
      // Polled by NavBar — unauthenticated callers get an empty list rather
      // than a 401, so the navbar does not flash error states between sessions.
      if (authErr instanceof AppError && authErr.code === "UNAUTHENTICATED") {
        return withCors(
          apiOk({ notifications: [], nextCursor: null, hasMore: false }),
          request.headers.get("origin"),
        );
      }
      throw authErr;
    }

    // Rate limit — 60 req/min per user. The NavBar polls this endpoint, so it
    // is the hottest authenticated route on the platform. Without a per-user
    // limit, a single misbehaving client can exhaust the DB connection pool.
    const limit = await rateLimit("notifications", `notif:${user.id}`);
    if (!limit.success) {
      return withCors(
        apiError("Too many requests", 429, "RATE_LIMITED"),
        request.headers.get("origin"),
      );
    }

    const { searchParams } = new URL(request.url);

    let query: z.infer<typeof notificationsQuerySchema>;
    try {
      query = notificationsQuerySchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return withCors(
          apiError("Validation failed", 400, "VALIDATION_ERROR"),
          request.headers.get("origin"),
        );
      }
      throw err;
    }

    const { cursor, limit: pageLimit } = query;

    const raw = await notificationRepository.findByUser(
      user.id,
      pageLimit + 1,
      cursor,
    );

    const hasMore = raw.length > pageLimit;
    const notifications = hasMore ? raw.slice(0, pageLimit) : raw;
    const nextCursor = hasMore ? (notifications.at(-1)?.id ?? null) : null;

    const response = withCors(
      apiOk({ notifications, nextCursor, hasMore }),
      request.headers.get("origin"),
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (e) {
    return withCors(
      handleRouteError(e, { path: "GET /api/v1/notifications" }),
      request.headers.get("origin"),
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const contentType = request.headers.get("content-type");
    if (contentType && !contentType.includes("application/json")) {
      return withCors(
        apiError("Content-Type must be application/json", 415),
        request.headers.get("origin"),
      );
    }

    const user = await requireApiUser(request);

    const limit = await rateLimit("notifications", `notif:${user.id}`);
    if (!limit.success) {
      return withCors(
        apiError("Too many requests", 429, "RATE_LIMITED"),
        request.headers.get("origin"),
      );
    }

    await notificationRepository.markAllRead(user.id);

    return withCors(apiOk(null), request.headers.get("origin"));
  } catch (e) {
    return withCors(
      handleRouteError(e, { path: "PATCH /api/v1/notifications" }),
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
