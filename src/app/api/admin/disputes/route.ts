import { requirePermission } from "@/shared/auth/requirePermission";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import db from "@/lib/db";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("VIEW_DISPUTES");
  } catch {
    return apiError("Unauthorised", 403);
  }

  try {
    const disputes = await db.order.findMany({
      where: { status: "DISPUTED" },
      include: {
        buyer: { select: { username: true, email: true } },
        seller: { select: { username: true, email: true } },
        listing: { select: { title: true } },
      },
      orderBy: { updatedAt: "asc" },
    });

    return apiOk({ disputes });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/admin/disputes",
      error: e instanceof Error ? e.message : e,
    });
    return apiError("Failed to load disputes. Please refresh.", 500);
  }
}
