// src/app/api/notifications/route.ts
// @deprecated — use /api/v1/notifications going forward
// ─── Notifications API ────────────────────────────────────────────────────────
// GET  /api/notifications   — latest 10 for NavBar dropdown
// PATCH /api/notifications  — mark all as read

import { auth } from "@/lib/auth";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";

export const dynamic = "force-dynamic";

function dep<T extends Response>(res: T): T {
  res.headers.set("Deprecation", "true");
  res.headers.set(
    "Sunset",
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString(),
  );
  res.headers.set("Link", '</api/v1/>; rel="successor-version"');
  return res;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return dep(apiOk({ notifications: [] }));
    }

    const notifications = await notificationRepository.findByUser(
      session.user.id,
      10,
    );

    const response = apiOk({ notifications });
    response.headers.set("Cache-Control", "private, no-store");
    dep(response);
    return response;
  } catch (e) {
    logger.error("api.error", {
      path: "/api/notifications",
      error: e instanceof Error ? e.message : e,
    });
    return dep(
      apiError("We couldn't load your notifications. Please try again.", 500),
    );
  }
}

export async function PATCH(request: Request) {
  try {
    // Pusher auth uses form-data, but this endpoint expects JSON
    const contentType = request.headers.get("content-type");
    if (contentType && !contentType.includes("application/json")) {
      return dep(apiError("Content-Type must be application/json", 415));
    }

    const session = await auth();
    if (!session?.user?.id) {
      return dep(apiError("Unauthorised", 401));
    }

    await notificationRepository.markAllRead(session.user.id);

    return dep(apiOk(null));
  } catch (e) {
    logger.error("api.error", {
      path: "/api/notifications",
      error: e instanceof Error ? e.message : e,
    });
    return dep(
      apiError("We couldn't update your notifications. Please try again.", 500),
    );
  }
}
