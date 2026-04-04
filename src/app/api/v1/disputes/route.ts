// src/app/api/v1/disputes/route.ts
// ─── Disputes API ─────────────────────────────────────────────────────────────
// POST /api/v1/disputes — open a dispute on an order (buyer only)

import { z } from "zod";
import { orderService } from "@/modules/orders/order.service";
import { getClientIp } from "@/server/lib/rateLimit";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../_helpers/response";
import { corsHeaders } from "../_helpers/cors";

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

    const body = await request.json().catch(() => null);
    if (!body) {
      return apiError("Invalid request body", 400, "VALIDATION_ERROR");
    }

    const parsed = openDisputeSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Validation failed", 400, "VALIDATION_ERROR");
    }

    const { orderId, reason, buyerStatement } = parsed.data;
    const ip = getClientIp(new Headers(request.headers)) ?? "unknown";

    await orderService.openDispute(
      { orderId, reason, description: buyerStatement },
      user.id,
      ip,
    );

    return apiOk({ opened: true, orderId }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
