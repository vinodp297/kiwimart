// src/app/api/cart/route.ts
// @deprecated — use /api/v1/cart going forward
// ─── Cart Count API — lightweight endpoint for NavBar badge polling ──────────

import { auth } from "@/lib/auth";
import { cartRepository } from "@/modules/cart/cart.repository";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import { withDeprecation } from "@/app/api/_helpers/deprecation";
import { MS_PER_DAY } from "@/lib/time";

const SUNSET = new Date(Date.now() + 90 * MS_PER_DAY);

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return withDeprecation(apiOk({ count: 0 }), SUNSET);
    }

    const cart = await cartRepository.findByUserCount(session.user.id);

    if (!cart || new Date(cart.expiresAt) < new Date()) {
      return withDeprecation(apiOk({ count: 0 }), SUNSET);
    }

    return withDeprecation(apiOk({ count: cart._count.items }), SUNSET);
  } catch (err) {
    logger.error("api.error", {
      path: "/api/cart",
      error: err instanceof Error ? err.message : String(err),
    });
    return withDeprecation(
      apiError("We couldn't process your cart request. Please try again.", 500),
      SUNSET,
    );
  }
}
