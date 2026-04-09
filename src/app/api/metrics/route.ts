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
import { withDeprecation } from "@/app/api/_helpers/deprecation";
import { MS_PER_DAY } from "@/lib/time";

export const dynamic = "force-dynamic";

const SUNSET = new Date(Date.now() + 90 * MS_PER_DAY);

export async function GET() {
  // Auth guard — requires VIEW_ALL_METRICS permission (DB-backed, not JWT claim)
  let admin;
  try {
    admin = await requirePermission("VIEW_ALL_METRICS");
  } catch {
    return withDeprecation(apiError("Unauthorised", 403), SUNSET);
  }

  try {
    const metrics = await adminService.getBusinessMetrics();

    logger.info("metrics.requested", { requestedBy: admin.id });

    return withDeprecation(apiOk(metrics), SUNSET);
  } catch (e) {
    logger.error("api.error", {
      path: "/api/metrics",
      error: e instanceof Error ? e.message : e,
    });
    return withDeprecation(
      apiError("Failed to load metrics. Please try again.", 500),
      SUNSET,
    );
  }
}
