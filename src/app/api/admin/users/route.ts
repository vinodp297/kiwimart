// @deprecated — use /api/v1/ admin endpoints going forward
import { z } from "zod";
import { requirePermission } from "@/shared/auth/requirePermission";
import { adminUsersQuerySchema } from "@/modules/admin/admin.schema";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import { adminRepository } from "@/modules/admin/admin.repository";
import { logger } from "@/shared/logger";
import { withDeprecation } from "@/app/api/_helpers/deprecation";
import { MS_PER_DAY } from "@/lib/time";

export const dynamic = "force-dynamic";

const SUNSET = new Date(Date.now() + 90 * MS_PER_DAY);

export async function GET(request: Request) {
  try {
    await requirePermission("VIEW_USERS");
  } catch {
    return withDeprecation(apiError("Unauthorised", 403), SUNSET);
  }

  try {
    const url = new URL(request.url);

    let query: z.infer<typeof adminUsersQuerySchema>;
    try {
      query = adminUsersQuerySchema.parse(Object.fromEntries(url.searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return withDeprecation(
          apiError("Validation failed", 400, "VALIDATION_ERROR"),
          SUNSET,
        );
      }
      throw err;
    }

    const { page, q } = query;

    const users = await adminRepository.findUsersByPage(q ?? null, page);

    return withDeprecation(apiOk({ users }), SUNSET);
  } catch (e) {
    logger.error("api.error", {
      path: "/api/admin/users",
      error: e instanceof Error ? e.message : e,
    });
    return withDeprecation(
      apiError("Failed to load user list. Please refresh.", 500),
      SUNSET,
    );
  }
}
