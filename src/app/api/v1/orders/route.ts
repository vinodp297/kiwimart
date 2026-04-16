// src/app/api/v1/orders/route.ts
// ─── Orders API ──────────────────────────────────────────────────────────────

import { z, ZodError } from "zod";
import { ordersQuerySchema } from "@/modules/orders/order.schema";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../_helpers/response";
import { getCorsHeaders, withCors } from "../_helpers/cors";
import { orderRepository } from "@/modules/orders/order.repository";

export async function GET(request: Request) {
  // Separate read budget: 60/min. Does not consume the POST (order-creation)
  // budget of 5/hr, so browsing order history cannot lock out checkout.
  const rateLimited = await checkApiRateLimit(request, "orderRead");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);
    const { searchParams } = new URL(request.url);

    let query: z.infer<typeof ordersQuerySchema>;
    try {
      query = ordersQuerySchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof ZodError) {
        return withCors(
          apiError("Validation failed", 400, "VALIDATION_ERROR"),
          request.headers.get("origin"),
        );
      }
      throw err;
    }

    const { cursor, limit } = query;

    const raw = await orderRepository.findByBuyerCursor(
      user.id,
      limit + 1,
      cursor,
    );

    const hasMore = raw.length > limit;
    const orders = hasMore ? raw.slice(0, limit) : raw;
    const nextCursor = hasMore ? (orders.at(-1)?.id ?? null) : null;

    const res = withCors(
      apiOk({ orders, nextCursor, hasMore }),
      request.headers.get("origin"),
    );
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e) {
    return withCors(handleApiError(e), request.headers.get("origin"));
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
