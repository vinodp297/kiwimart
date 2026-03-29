// src/app/api/cart/route.ts
// @deprecated — use /api/v1/cart going forward
// ─── Cart Count API — lightweight endpoint for NavBar badge polling ──────────

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { logger } from "@/shared/logger";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: true, data: { count: 0 } });
    }

    const cart = await db.cart.findUnique({
      where: { userId: session.user.id },
      select: {
        expiresAt: true,
        _count: { select: { items: true } },
      },
    });

    if (!cart || new Date(cart.expiresAt) < new Date()) {
      return NextResponse.json({ success: true, data: { count: 0 } });
    }

    return NextResponse.json({
      success: true,
      data: { count: cart._count.items },
    });
  } catch (err) {
    logger.error("api.error", {
      path: "/api/cart",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: "Something went wrong" },
      { status: 500 },
    );
  }
}
