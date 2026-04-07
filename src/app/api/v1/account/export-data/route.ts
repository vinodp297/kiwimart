// src/app/api/v1/account/export-data/route.ts
// ─── PII Data Export — NZ Privacy Act 2020 ───────────────────────────────────
// Exports all personal data for the authenticated user and emails it to their
// verified email address. Rate limited to once per 30 days.

import { exportUserData } from "@/modules/users/export.service";
import { AppError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { apiOk, apiError, requireApiUser } from "../../_helpers/response";
import { withCors, getCorsHeaders } from "../../_helpers/cors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);

    await exportUserData(user.id, user.email);

    return withCors(
      apiOk({
        message: `Your data export has been emailed to ${user.email}. This may take a few minutes.`,
      }),
      request.headers.get("origin"),
    );
  } catch (e) {
    if (e instanceof AppError) {
      return withCors(
        apiError(e.message, e.statusCode, e.code),
        request.headers.get("origin"),
      );
    }

    logger.error("api.error", {
      path: "/api/v1/account/export-data",
      error: e instanceof Error ? e.message : e,
    });

    return withCors(
      apiError("Failed to export data. Please try again.", 500),
      request.headers.get("origin"),
    );
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
