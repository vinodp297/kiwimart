// src/app/api/v1/disputes/route.ts
// ─── Disputes API ─────────────────────────────────────────────────────────────
// POST /api/v1/disputes — open a dispute on an order (buyer only)

import { z } from "zod";
import { orderService } from "@/modules/orders/order.service";
import { getClientIp, rateLimit } from "@/server/lib/rateLimit";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../_helpers/response";
import { corsHeaders, withCors } from "../_helpers/cors";

const openDisputeSchema = z.object({
  orderId: z.string().min(1),
  reason: z.enum([
    "ITEM_NOT_RECEIVED",
    "ITEM_NOT_AS_DESCRIBED",
    "ITEM_DAMAGED",
    "WRONG_ITEM_SENT",
    "COUNTERFEIT_ITEM",
    "SELLER_UNRESPONSIVE",
    "SELLER_CANCELLED",
    "REFUND_NOT_PROCESSED",
    "OTHER",
  ]),
  buyerStatement: z.string().min(10).max(2000),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);

    const rl = await rateLimit("disputes", user.id);
    if (!rl.success) {
      return withCors(
        apiError(
          `Too many disputes opened. Try again in ${rl.retryAfter} seconds.`,
          429,
          "RATE_LIMITED",
        ),
      );
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
      );
    }

    const parsed = openDisputeSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(apiError("Validation failed", 400, "VALIDATION_ERROR"));
    }

    const { orderId, reason, buyerStatement } = parsed.data;
    const ip = getClientIp(new Headers(request.headers)) ?? "unknown";

    await orderService.openDispute(
      { orderId, reason, description: buyerStatement },
      user.id,
      ip,
    );

    return withCors(apiOk({ opened: true, orderId }, 201));
  } catch (e) {
    return withCors(handleApiError(e));
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
