// src/app/api/v1/pickup/reschedule/respond/route.ts
// POST /api/v1/pickup/reschedule/respond — Respond to a reschedule request

import { z } from "zod";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../../../_helpers/response";
import { getCorsHeaders, withCors } from "../../../_helpers/cors";
import { rescheduleRespondSchema } from "@/modules/pickup/pickup.schema";
import { respondToReschedule } from "@/server/services/pickup/pickup-reschedule-respond.service";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);

    let body: z.infer<typeof rescheduleRespondSchema>;
    try {
      body = rescheduleRespondSchema.parse(await request.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return withCors(
          apiError("Validation failed", 400, "VALIDATION_ERROR"),
          request.headers.get("origin"),
        );
      }
      throw err;
    }

    let alternativeTime: Date | undefined;
    if (body.response === "PROPOSE_ALTERNATIVE") {
      if (!body.alternativeTime) {
        return withCors(
          apiError("alternativeTime is required for PROPOSE_ALTERNATIVE.", 400),
          request.headers.get("origin"),
        );
      }
      alternativeTime = new Date(body.alternativeTime);
    }

    const result = await respondToReschedule({
      orderId: body.orderId,
      rescheduleRequestId: body.rescheduleRequestId,
      respondedById: user.id,
      response: body.response,
      alternativeTime,
      responseNote: body.responseNote,
    });

    if (!result.success) {
      return withCors(
        apiError(result.error!, 400),
        request.headers.get("origin"),
      );
    }

    return withCors(apiOk({ responded: true }), request.headers.get("origin"));
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
