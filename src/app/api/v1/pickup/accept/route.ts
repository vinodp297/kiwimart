// src/app/api/v1/pickup/accept/route.ts
// POST /api/v1/pickup/accept — Accept a proposed pickup time

import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../../_helpers/response";
import { acceptPickupTime } from "@/server/services/pickup/pickup-scheduling.service";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser();
    const body = (await request.json()) as {
      orderId?: string;
      rescheduleRequestId?: string;
    };

    if (!body.orderId) {
      return apiError("orderId is required.", 400);
    }

    const result = await acceptPickupTime({
      orderId: body.orderId,
      acceptedById: user.id,
      rescheduleRequestId: body.rescheduleRequestId,
    });

    if (!result.success) {
      return apiError(result.error!, 400);
    }

    return apiOk({ accepted: true });
  } catch (e) {
    return handleApiError(e);
  }
}
