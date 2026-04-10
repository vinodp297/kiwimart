// @deprecated — use /api/v1/ admin endpoints going forward
import { z } from "zod";
import { requirePermission } from "@/shared/auth/requirePermission";
import { adminCursorQuerySchema } from "@/modules/admin/admin.schema";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import { adminRepository } from "@/modules/admin/admin.repository";
import { withDeprecation } from "@/app/api/_helpers/deprecation";
import { handleRouteError } from "@/server/lib/handle-route-error";
import { MS_PER_DAY } from "@/lib/time";

export const dynamic = "force-dynamic";

const SUNSET = new Date(Date.now() + 90 * MS_PER_DAY);

export async function GET(request: Request) {
  try {
    await requirePermission("VIEW_REPORTS");
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

    const raw = await adminRepository.findOpenReportsCursor(limit + 1, cursor);

    const hasMore = raw.length > limit;
    const reports = hasMore ? raw.slice(0, limit) : raw;
    const nextCursor = hasMore ? (reports.at(-1)?.id ?? null) : null;

    return withDeprecation(apiOk({ reports, nextCursor, hasMore }), SUNSET);
  } catch (e) {
    return withDeprecation(
      handleRouteError(e, { path: "/api/admin/reports" }),
      SUNSET,
    );
  }
}
