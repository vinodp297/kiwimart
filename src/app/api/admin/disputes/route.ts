// @deprecated — use /api/v1/ admin endpoints going forward
import { z } from "zod";
import { requirePermission } from "@/shared/auth/requirePermission";
import { adminCursorQuerySchema } from "@/modules/admin/admin.schema";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import { adminRepository } from "@/modules/admin/admin.repository";
import { logger } from "@/shared/logger";

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

export async function GET(request: Request) {
  try {
    await requirePermission("VIEW_DISPUTES");
  } catch {
    return dep(apiError("Unauthorised", 403));
  }

  try {
    const { searchParams } = new URL(request.url);

    let query: z.infer<typeof adminCursorQuerySchema>;
    try {
      query = adminCursorQuerySchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return dep(apiError("Validation failed", 400, "VALIDATION_ERROR"));
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

    return dep(apiOk({ disputes, nextCursor, hasMore }));
  } catch (e) {
    logger.error("api.error", {
      path: "/api/admin/disputes",
      error: e instanceof Error ? e.message : e,
    });
    return dep(apiError("Failed to load disputes. Please refresh.", 500));
  }
}
