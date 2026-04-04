// src/app/api/v1/notifications/route.ts
// GET  /api/v1/notifications  — cursor-paginated notifications for NavBar / full list
// PATCH /api/v1/notifications — mark all as read

import { z } from "zod";
import { auth } from "@/lib/auth";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import { notificationsQuerySchema } from "@/modules/notifications/notification.schema";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "../_helpers/response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiOk({ notifications: [], nextCursor: null, hasMore: false });
    }

    const { searchParams } = new URL(request.url);

    let query: z.infer<typeof notificationsQuerySchema>;
    try {
      query = notificationsQuerySchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return apiError("Validation failed", 400, "VALIDATION_ERROR");
      }
      throw err;
    }

    const { cursor, limit } = query;

    const raw = await notificationRepository.findByUser(
      session.user.id,
      limit + 1,
      cursor,
    );

    const hasMore = raw.length > limit;
    const notifications = hasMore ? raw.slice(0, limit) : raw;
    const nextCursor = hasMore ? (notifications.at(-1)?.id ?? null) : null;

    return apiOk({ notifications, nextCursor, hasMore });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/v1/notifications",
      error: e instanceof Error ? e.message : e,
    });
    return apiError(
      "We couldn't load your notifications. Please try again.",
      500,
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const contentType = request.headers.get("content-type");
    if (contentType && !contentType.includes("application/json")) {
      return apiError("Content-Type must be application/json", 415);
    }

    const session = await auth();
    if (!session?.user?.id) {
      return apiError("Unauthorised", 401);
    }

    await notificationRepository.markAllRead(session.user.id);

    return apiOk(null);
  } catch (e) {
    logger.error("api.error", {
      path: "/api/v1/notifications",
      error: e instanceof Error ? e.message : e,
    });
    return apiError(
      "We couldn't update your notifications. Please try again.",
      500,
    );
  }
}
