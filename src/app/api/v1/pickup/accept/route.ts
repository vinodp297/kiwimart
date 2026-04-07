// src/app/api/v1/pickup/accept/route.ts
// POST /api/v1/pickup/accept — Accept a proposed pickup time

import { z } from "zod";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";
import { acceptPickupSchema } from "@/modules/pickup/pickup.schema";
import { acceptPickupTime } from "@/server/services/pickup/pickup-proposal.service";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser();

    let body: z.infer<typeof acceptPickupSchema>;
    try {
      body = acceptPickupSchema.parse(await request.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return withCors(
          apiError("Validation failed", 400, "VALIDATION_ERROR"),
          request.headers.get("origin"),
        );
      }
      throw err;
    }

    const result = await acceptPickupTime({
      orderId: body.orderId,
      acceptedById: user.id,
      rescheduleRequestId: body.rescheduleRequestId,
    });

    if (!result.success) {
      return withCors(
        apiError(result.error!, 400),
        request.headers.get("origin"),
      );
    }

    return withCors(apiOk({ accepted: true }), request.headers.get("origin"));
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
