// src/app/api/admin/users/[userId]/erase/route.ts
// ─── Admin Account Erasure — NZ Privacy Act 2020 ─────────────────────────────
// Admin-initiated erasure (e.g. court order, user complaint via support).
// Requires SUPER_ADMIN role. Creates an ErasureLog with the admin's userId.

import { NextResponse } from "next/server";
import { performAccountErasure } from "@/modules/users/erasure.service";
import { requireSuperAdmin } from "@/shared/auth/requirePermission";
import { AppError } from "@/shared/errors";
import { logger } from "@/shared/logger";

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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { userId } = await params;

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
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.statusCode },
      );
    }

    logger.error("api.error", {
      path: "/api/admin/users/:userId/erase",
      error: e instanceof Error ? e.message : e,
    });

    return NextResponse.json(
      { error: "Failed to erase account. Please try again." },
      { status: 500 },
    );
  }
}
