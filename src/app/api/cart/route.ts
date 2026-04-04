// src/app/api/cart/route.ts
// @deprecated — use /api/v1/cart going forward
// ─── Cart Count API — lightweight endpoint for NavBar badge polling ──────────

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { logger } from "@/shared/logger";

function dep<T extends Response>(res: T): T {
  res.headers.set("Deprecation", "true");
  res.headers.set(
    "Sunset",
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString(),
  );
  res.headers.set("Link", '</api/v1/>; rel="successor-version"');
  return res;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return dep(NextResponse.json({ success: true, data: { count: 0 } }));
    }

    const cart = await db.cart.findUnique({
      where: { userId: session.user.id },
      select: {
        expiresAt: true,
        _count: { select: { items: true } },
      },
    });

    if (!cart || new Date(cart.expiresAt) < new Date()) {
      return dep(NextResponse.json({ success: true, data: { count: 0 } }));
    }

    return dep(
      NextResponse.json({
        success: true,
        data: { count: cart._count.items },
      }),
    );
  } catch (err) {
    logger.error("api.error", {
      path: "/api/cart",
      error: err instanceof Error ? err.message : String(err),
    });
    return dep(
      NextResponse.json(
        {
          success: false,
          error: "We couldn't process your cart request. Please try again.",
        },
        { status: 500 },
      ),
    );
  }
}
