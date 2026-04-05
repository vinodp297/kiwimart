// src/app/api/v1/orders/route.ts
// ─── Orders API ──────────────────────────────────────────────────────────────

import { z } from "zod";
import { ordersQuerySchema } from "@/modules/orders/order.schema";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../_helpers/response";
import { getCorsHeaders, withCors } from "../_helpers/cors";
import db from "@/lib/db";

export async function GET(request: Request) {
  // Rate limit: reuse order limiter (5/hr)
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);
    const { searchParams } = new URL(request.url);

    let query: z.infer<typeof ordersQuerySchema>;
    try {
      query = ordersQuerySchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return withCors(apiError("Validation failed", 400, "VALIDATION_ERROR"));
      }
      throw err;
    }

    const { cursor, limit } = query;

    const raw = await db.order.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        totalNzd: true,
        createdAt: true,
        listing: {
          select: { id: true, title: true },
        },
      },
    });

    const hasMore = raw.length > limit;
    const orders = hasMore ? raw.slice(0, limit) : raw;
    const nextCursor = hasMore ? (orders.at(-1)?.id ?? null) : null;

    const res = withCors(apiOk({ orders, nextCursor, hasMore }));
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e) {
    return withCors(handleApiError(e));
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: getCorsHeaders() });
}
