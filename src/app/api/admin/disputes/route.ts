import { z } from "zod";
import { requirePermission } from "@/shared/auth/requirePermission";
import { adminCursorQuerySchema } from "@/modules/admin/admin.schema";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import db from "@/lib/db";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requirePermission("VIEW_DISPUTES");
  } catch {
    return apiError("Unauthorised", 403);
  }

  try {
    const { searchParams } = new URL(request.url);

    let query: z.infer<typeof adminCursorQuerySchema>;
    try {
      query = adminCursorQuerySchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return apiError("Validation failed", 400, "VALIDATION_ERROR");
      }
      throw err;
    }

    const { cursor, limit } = query;

    const raw = await db.order.findMany({
      where: { status: "DISPUTED" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        buyer: { select: { username: true, email: true } },
        seller: { select: { username: true, email: true } },
        listing: { select: { title: true } },
      },
      orderBy: { updatedAt: "asc" },
    });

    const hasMore = raw.length > limit;
    const disputes = hasMore ? raw.slice(0, limit) : raw;
    const nextCursor = hasMore ? (disputes.at(-1)?.id ?? null) : null;

    return apiOk({ disputes, nextCursor, hasMore });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/admin/disputes",
      error: e instanceof Error ? e.message : e,
    });
    return apiError("Failed to load disputes. Please refresh.", 500);
  }
}
