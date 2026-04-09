// @deprecated — use /api/v1/ admin endpoints going forward
import { z } from "zod";
import { requirePermission } from "@/shared/auth/requirePermission";
import { adminCursorQuerySchema } from "@/modules/admin/admin.schema";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import { adminRepository } from "@/modules/admin/admin.repository";
import { logger } from "@/shared/logger";
import { withDeprecation } from "@/app/api/_helpers/deprecation";
import { MS_PER_DAY } from "@/lib/time";

export const dynamic = "force-dynamic";

const SUNSET = new Date(Date.now() + 90 * MS_PER_DAY);

export async function GET(request: Request) {
  try {
    await requirePermission("VIEW_DISPUTES");
  } catch {
    return withDeprecation(apiError("Unauthorised", 403), SUNSET);
  }

  try {
    const { searchParams } = new URL(request.url);

    let query: z.infer<typeof adminCursorQuerySchema>;
    try {
      query = adminCursorQuerySchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return withDeprecation(
          apiError("Validation failed", 400, "VALIDATION_ERROR"),
          SUNSET,
        );
      }
      throw err;
    }

    const { cursor, limit } = query;

    const raw = await adminRepository.findDisputedOrdersCursor(
      limit + 1,
      cursor,
    );

    const hasMore = raw.length > limit;
    const disputes = hasMore ? raw.slice(0, limit) : raw;
    const nextCursor = hasMore ? (disputes.at(-1)?.id ?? null) : null;

    return withDeprecation(apiOk({ disputes, nextCursor, hasMore }), SUNSET);
  } catch (e) {
    logger.error("api.error", {
      path: "/api/admin/disputes",
      error: e instanceof Error ? e.message : e,
    });
    return withDeprecation(
      apiError("Failed to load disputes. Please refresh.", 500),
      SUNSET,
    );
  }
}
