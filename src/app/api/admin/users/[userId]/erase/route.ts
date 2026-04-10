// src/app/api/admin/users/[userId]/erase/route.ts
// ─── Admin Account Erasure — NZ Privacy Act 2020 ─────────────────────────────
// Admin-initiated erasure (e.g. court order, user complaint via support).
// Requires SUPER_ADMIN role. Creates an ErasureLog with the admin's userId.

import { NextResponse } from "next/server";
import { performAccountErasure } from "@/modules/users/erasure.service";
import { requireSuperAdmin } from "@/shared/auth/requirePermission";
import { rateLimit } from "@/server/lib/rateLimit";
import { AppError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { apiError } from "@/app/api/v1/_helpers/response";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  // Auth guard — requires SUPER_ADMIN role
  let admin;
  try {
    admin = await requireSuperAdmin();
  } catch {
    return apiError("Forbidden", 403);
  }

  try {
    const { userId } = await params;

    // Rate limit — 5 account erasures per hour per admin (keyed by admin ID)
    try {
      const limit = await rateLimit("adminErase", `admin:${admin.id}:erase`);
      if (!limit.success) {
        return apiError(
          "Too many requests. Please slow down.",
          429,
          "RATE_LIMITED",
        );
      }
    } catch (rlErr) {
      logger.warn("admin:rate-limit-unavailable", {
        action: "erase",
        adminId: admin.id,
        error: rlErr instanceof Error ? rlErr.message : String(rlErr),
      });
      // Fail open — allow the action if rate limiter is unavailable
    }

    const result = await performAccountErasure({
      userId,
      operatorId: admin.id,
    });

    logger.info("admin.account.erased", {
      targetUserId: userId,
      adminId: admin.id,
      erasureLogId: result.erasureLogId,
    });

    return NextResponse.json({
      success: true,
      erasureLogId: result.erasureLogId,
      anonymisedEmail: result.anonymisedEmail,
    });
  } catch (e) {
    if (e instanceof AppError) {
      return apiError(e.message, e.statusCode, e.code);
    }

    logger.error("api.error", {
      path: "/api/admin/users/:userId/erase",
      error: e instanceof Error ? e.message : e,
    });

    return apiError("Failed to erase account. Please try again.", 500);
  }
}
