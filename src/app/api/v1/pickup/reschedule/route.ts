// src/app/api/v1/pickup/reschedule/route.ts
// POST /api/v1/pickup/reschedule — Request a pickup reschedule

import { z } from "zod";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../../_helpers/response";
import { corsHeaders, withCors } from "../../_helpers/cors";
import { reschedulePickupSchema } from "@/modules/pickup/pickup.schema";
import { requestReschedule } from "@/server/services/pickup/pickup-scheduling.service";
import db from "@/lib/db";
import type {
  SellerRescheduleReason,
  BuyerRescheduleReason,
} from "@prisma/client";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser();

    let body: z.infer<typeof reschedulePickupSchema>;
    try {
      body = reschedulePickupSchema.parse(await request.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return apiError("Validation failed", 400, "VALIDATION_ERROR");
      }
      throw err;
    }

    const proposedTime = new Date(body.proposedTime);

    // Determine role
    const order = await db.order.findUnique({
      where: { id: body.orderId },
      select: { buyerId: true, sellerId: true },
    });

    if (!order) return withCors(apiError("Order not found.", 404));

    let role: "BUYER" | "SELLER";
    if (user.id === order.buyerId) role = "BUYER";
    else if (user.id === order.sellerId) role = "SELLER";
    else return withCors(apiError("You are not a party to this order.", 403));

    const result = await requestReschedule({
      orderId: body.orderId,
      requestedById: user.id,
      requestedByRole: role,
      sellerReason: body.sellerReason as SellerRescheduleReason | undefined,
      buyerReason: body.buyerReason as BuyerRescheduleReason | undefined,
      reasonNote: body.reasonNote,
      proposedTime,
    });

    if (!result.success) {
      return withCors(apiError(result.error!, 400));
    }

    return withCors(
      apiOk({
        rescheduled: true,
        forceCancelAvailable: result.forceCancelAvailable ?? false,
      }),
    );
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
