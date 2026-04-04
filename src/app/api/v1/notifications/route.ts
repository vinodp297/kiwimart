// src/app/api/v1/notifications/route.ts
// GET  /api/v1/notifications  — latest 10 for NavBar dropdown
// PATCH /api/v1/notifications — mark all as read

import { auth } from "@/lib/auth";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "../_helpers/response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiOk({ notifications: [] });
    }

    const notifications = await notificationRepository.findByUser(
      session.user.id,
      10,
    );

    return apiOk({ notifications });
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
