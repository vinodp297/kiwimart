// src/app/api/metrics/route.ts
// ─── Business Metrics Endpoint ───────────────────────────────────────────────
// Admin-only endpoint returning business health metrics for the internal
// dashboard. Requires VIEW_ALL_METRICS permission — DB-backed check, not a
// stale JWT claim. This prevents a revoked admin from accessing metrics via a
// still-valid session token.

import { requirePermission } from "@/shared/auth/requirePermission";
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
  // Auth guard — requires VIEW_ALL_METRICS permission (DB-backed, not JWT claim)
  let admin;
  try {
    admin = await requirePermission("VIEW_ALL_METRICS");
  } catch {
    return dep(apiError("Unauthorised", 403));
  }

  try {
    const metrics = await adminService.getBusinessMetrics();

    logger.info("metrics.requested", { requestedBy: admin.id });

    return dep(apiOk(metrics));
  } catch (e) {
    logger.error("api.error", {
      path: "/api/metrics",
      error: e instanceof Error ? e.message : e,
    });
    return dep(apiError("Failed to load metrics. Please try again.", 500));
  }
}
