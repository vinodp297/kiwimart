// src/app/api/notifications/route.ts
// @deprecated — use /api/v1/notifications going forward
// ─── Notifications API ────────────────────────────────────────────────────────
// GET  /api/notifications   — latest 10 for NavBar dropdown
// PATCH /api/notifications  — mark all as read

import { auth } from "@/lib/auth";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import { withDeprecation } from "@/app/api/_helpers/deprecation";
import { MS_PER_DAY } from "@/lib/time";

export const dynamic = "force-dynamic";

const SUNSET = new Date(Date.now() + 90 * MS_PER_DAY);

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return withDeprecation(apiOk({ notifications: [] }), SUNSET);
    }

    const notifications = await notificationRepository.findByUser(
      session.user.id,
      10,
    );

    const response = apiOk({ notifications });
    response.headers.set("Cache-Control", "private, no-store");
    withDeprecation(response, SUNSET);
    return response;
  } catch (e) {
    logger.error("api.error", {
      path: "/api/notifications",
      error: e instanceof Error ? e.message : e,
    });
    return withDeprecation(
      apiError("We couldn't load your notifications. Please try again.", 500),
      SUNSET,
    );
  }
}

export async function PATCH(request: Request) {
  try {
    // Pusher auth uses form-data, but this endpoint expects JSON
    const contentType = request.headers.get("content-type");
    if (contentType && !contentType.includes("application/json")) {
      return withDeprecation(
        apiError("Content-Type must be application/json", 415),
        SUNSET,
      );
    }

    const session = await auth();
    if (!session?.user?.id) {
      return withDeprecation(apiError("Unauthorised", 401), SUNSET);
    }

    await notificationRepository.markAllRead(session.user.id);

    return withDeprecation(apiOk(null), SUNSET);
  } catch (e) {
    logger.error("api.error", {
      path: "/api/notifications",
      error: e instanceof Error ? e.message : e,
    });
    return withDeprecation(
      apiError("We couldn't update your notifications. Please try again.", 500),
      SUNSET,
    );
  }
}
