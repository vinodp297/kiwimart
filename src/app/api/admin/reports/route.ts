import { requirePermission } from "@/shared/auth/requirePermission";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import db from "@/lib/db";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("VIEW_REPORTS");
  } catch {
    return apiError("Unauthorised", 403);
  }

  try {
    const reports = await db.report.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      include: {
        reporter: { select: { username: true } },
      },
    });

    return apiOk({ reports });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/admin/reports",
      error: e instanceof Error ? e.message : e,
    });
    return apiError("Failed to load reports. Please refresh.", 500);
  }
}
