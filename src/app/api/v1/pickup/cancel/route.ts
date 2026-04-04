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
import { cancelPickupSchema } from "@/modules/pickup/pickup.schema";
import { cancelPickupOrder } from "@/server/services/pickup/pickup-scheduling.service";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser();

    let body: z.infer<typeof cancelPickupSchema>;
    try {
      body = cancelPickupSchema.parse(await request.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return apiError("Validation failed", 400, "VALIDATION_ERROR");
      }
      throw err;
    }

    if (body.reason.trim().length < 5) {
      return apiError("Please provide a meaningful reason.", 400);
    }

    const result = await cancelPickupOrder({
      orderId: body.orderId,
      cancelledById: user.id,
      reason: body.reason,
    });

    if (!result.success) {
      return apiError(result.error!, 400);
    }

    return apiOk({ cancelled: true });
  } catch (e) {
    return handleApiError(e);
  }
}
