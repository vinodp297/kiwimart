import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/auth/requirePermission";
import db from "@/lib/db";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("VIEW_REPORTS");
  } catch {
    return NextResponse.json({ error: "Unauthorised" }, { status: 403 });
  }

  try {
    const reports = await db.report.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      include: {
        reporter: { select: { username: true } },
      },
    });

    return NextResponse.json({ reports });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/admin/reports",
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      { error: "Failed to load reports. Please refresh." },
      { status: 500 },
    );
  }
}
