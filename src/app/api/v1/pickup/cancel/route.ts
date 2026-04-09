// src/app/api/v1/pickup/cancel/route.ts
// POST /api/v1/pickup/cancel — Cancel a pickup order

import { z } from "zod";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";
import { cancelPickupSchema } from "@/modules/pickup/pickup.schema";
import { cancelPickupOrder } from "@/server/services/pickup/pickup-cancel.service";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);

    let body: z.infer<typeof cancelPickupSchema>;
    try {
      body = cancelPickupSchema.parse(await request.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return withCors(
          apiError("Validation failed", 400, "VALIDATION_ERROR"),
          request.headers.get("origin"),
        );
      }
      throw err;
    }

    if (body.reason.trim().length < 5) {
      return withCors(
        apiError("Please provide a meaningful reason.", 400),
        request.headers.get("origin"),
      );
    }

    const result = await cancelPickupOrder({
      orderId: body.orderId,
      cancelledById: user.id,
      reason: body.reason,
    });

    if (!result.success) {
      return withCors(
        apiError(result.error!, 400),
        request.headers.get("origin"),
      );
    }

    return withCors(apiOk({ cancelled: true }), request.headers.get("origin"));
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
