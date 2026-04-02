// src/app/api/v1/pickup/cancel/route.ts
// POST /api/v1/pickup/cancel — Cancel a pickup order

import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../../_helpers/response";
import { cancelPickupOrder } from "@/server/services/pickup/pickup-scheduling.service";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser();
    const body = (await request.json()) as {
      orderId?: string;
      reason?: string;
    };

    if (!body.orderId || !body.reason) {
      return apiError("orderId and reason are required.", 400);
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
