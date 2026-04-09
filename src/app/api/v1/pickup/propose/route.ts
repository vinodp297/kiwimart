// src/app/api/v1/pickup/propose/route.ts
// POST /api/v1/pickup/propose — Propose a pickup time

import { z } from "zod";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";
import { proposePickupSchema } from "@/modules/pickup/pickup.schema";
import { proposePickupTime } from "@/server/services/pickup/pickup-proposal.service";
import { orderRepository } from "@/modules/orders/order.repository";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);

    let body: z.infer<typeof proposePickupSchema>;
    try {
      body = proposePickupSchema.parse(await request.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return withCors(
          apiError("Validation failed", 400, "VALIDATION_ERROR"),
          request.headers.get("origin"),
        );
      }
      throw err;
    }

    const proposedTime = new Date(body.proposedTime);

    // Determine role
    const order = await orderRepository.findParties(body.orderId);

    if (!order)
      return withCors(
        apiError("Order not found.", 404),
        request.headers.get("origin"),
      );

    let role: "BUYER" | "SELLER";
    if (user.id === order.buyerId) role = "BUYER";
    else if (user.id === order.sellerId) role = "SELLER";
    else
      return withCors(
        apiError("You are not a party to this order.", 403),
        request.headers.get("origin"),
      );

    const result = await proposePickupTime({
      orderId: body.orderId,
      proposedById: user.id,
      proposedByRole: role,
      proposedTime,
    });

    if (!result.success) {
      return withCors(
        apiError(result.error!, 400),
        request.headers.get("origin"),
      );
    }

    return withCors(apiOk({ proposed: true }), request.headers.get("origin"));
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
