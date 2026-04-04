// src/app/api/v1/cart/route.ts
// GET  /api/v1/cart — cart item count for NavBar badge polling
// POST /api/v1/cart — add a listing to the cart

import { z } from "zod";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { cartService } from "@/modules/cart/cart.service";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../_helpers/response";
import { corsHeaders, withCors } from "../_helpers/cors";

export const dynamic = "force-dynamic";

const addToCartSchema = z.object({
  listingId: z.string().min(1),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return withCors(apiOk({ count: 0 }));
    }

    const cart = await db.cart.findUnique({
      where: { userId: session.user.id },
      select: {
        expiresAt: true,
        _count: { select: { items: true } },
      },
    });

    if (!cart || new Date(cart.expiresAt) < new Date()) {
      return withCors(apiOk({ count: 0 }));
    }

    return withCors(apiOk({ count: cart._count.items }));
  } catch (err) {
    logger.error("api.error", {
      path: "/api/v1/cart",
      error: err instanceof Error ? err.message : String(err),
    });
    return withCors(
      apiError("We couldn't process your cart request. Please try again.", 500),
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);

    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
      );
    }

    const parsed = addToCartSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(apiError("Validation failed", 400, "VALIDATION_ERROR"));
    }

    const result = await cartService.addToCart(user.id, parsed.data.listingId);
    if (!result.ok) {
      return withCors(
        apiError(result.error ?? "Failed to add to cart", 400, "CART_ERROR"),
      );
    }

    return withCors(apiOk({ cartItemCount: result.data.cartItemCount }));
  } catch (e) {
    return withCors(handleApiError(e));
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
