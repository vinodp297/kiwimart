// src/app/api/cart/route.ts
// @deprecated — use /api/v1/cart going forward
// ─── Cart Count API — lightweight endpoint for NavBar badge polling ──────────

import { auth } from "@/lib/auth";
import { cartRepository } from "@/modules/cart/cart.repository";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";

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
      return dep(apiOk({ count: 0 }));
    }

    const cart = await cartRepository.findByUserCount(session.user.id);

    if (!cart || new Date(cart.expiresAt) < new Date()) {
      return dep(apiOk({ count: 0 }));
    }

    return dep(apiOk({ count: cart._count.items }));
  } catch (err) {
    logger.error("api.error", {
      path: "/api/cart",
      error: err instanceof Error ? err.message : String(err),
    });
    return dep(
      apiError("We couldn't process your cart request. Please try again.", 500),
    );
  }
}
