// src/app/api/metrics/route.ts
// ─── Business Metrics Endpoint ───────────────────────────────────────────────
// Admin-only endpoint returning business health metrics for the internal
// dashboard. Requires an active admin session.

import { auth } from "@/lib/auth";
import { adminService } from "@/modules/admin/admin.service";
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
    // Admin only
    const session = await auth();
    const user = session?.user as { id: string; isAdmin?: boolean } | undefined;

    if (!user?.isAdmin) {
      return apiError("Unauthorised", 403);
    }

    const metrics = await adminService.getBusinessMetrics();

    logger.info("metrics.requested", { requestedBy: user.id });

    return dep(apiOk(metrics));
  } catch (e) {
    logger.error("api.error", {
      path: "/api/metrics",
      error: e instanceof Error ? e.message : e,
    });
    return dep(apiError("Failed to load metrics. Please try again.", 500));
  }
}
