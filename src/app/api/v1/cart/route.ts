// src/app/api/v1/cart/route.ts
// GET /api/v1/cart — cart item count for NavBar badge polling

import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "../_helpers/response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiOk({ count: 0 });
    }

    const cart = await db.cart.findUnique({
      where: { userId: session.user.id },
      select: {
        expiresAt: true,
        _count: { select: { items: true } },
      },
    });

    if (!cart || new Date(cart.expiresAt) < new Date()) {
      return apiOk({ count: 0 });
    }

    return apiOk({ count: cart._count.items });
  } catch (err) {
    logger.error("api.error", {
      path: "/api/v1/cart",
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError(
      "We couldn't process your cart request. Please try again.",
      500,
    );
  }
}
