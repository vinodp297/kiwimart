// src/app/api/notifications/route.ts
// @deprecated — use /api/v1/notifications going forward
// ─── Notifications API ────────────────────────────────────────────────────────
// GET  /api/notifications   — latest 10 for NavBar dropdown
// PATCH /api/notifications  — mark all as read

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ notifications: [] });
    }

    const notifications = await db.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        read: true,
        link: true,
        listingId: true,
        orderId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, data: { notifications } });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/notifications",
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      {
        success: false,
        error: "We couldn't load your notifications. Please try again.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    // Pusher auth uses form-data, but this endpoint expects JSON
    const contentType = request.headers.get("content-type");
    if (contentType && !contentType.includes("application/json")) {
      return NextResponse.json(
        { success: false, error: "Content-Type must be application/json" },
        { status: 415 },
      );
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorised" },
        { status: 401 },
      );
    }

    await db.notification.updateMany({
      where: { userId: session.user.id, read: false },
      data: { read: true },
    });

    return NextResponse.json({ success: true, data: null });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/notifications",
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      {
        success: false,
        error: "We couldn't update your notifications. Please try again.",
      },
      { status: 500 },
    );
  }
}
