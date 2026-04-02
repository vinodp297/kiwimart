// src/app/api/v1/pickup/reschedule/respond/route.ts
// POST /api/v1/pickup/reschedule/respond — Respond to a reschedule request

import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../../../_helpers/response";
import { respondToReschedule } from "@/server/services/pickup/pickup-scheduling.service";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser();
    const body = (await request.json()) as {
      orderId?: string;
      rescheduleRequestId?: string;
      response?: "ACCEPT" | "REJECT" | "PROPOSE_ALTERNATIVE";
      alternativeTime?: string;
      responseNote?: string;
    };

    if (!body.orderId || !body.rescheduleRequestId || !body.response) {
      return apiError(
        "orderId, rescheduleRequestId, and response are required.",
        400,
      );
    }

    const validResponses = ["ACCEPT", "REJECT", "PROPOSE_ALTERNATIVE"];
    if (!validResponses.includes(body.response)) {
      return apiError(
        "response must be ACCEPT, REJECT, or PROPOSE_ALTERNATIVE.",
        400,
      );
    }

    let alternativeTime: Date | undefined;
    if (body.response === "PROPOSE_ALTERNATIVE") {
      if (!body.alternativeTime) {
        return apiError(
          "alternativeTime is required for PROPOSE_ALTERNATIVE.",
          400,
        );
      }
      alternativeTime = new Date(body.alternativeTime);
      if (isNaN(alternativeTime.getTime())) {
        return apiError("Invalid alternativeTime format.", 400);
      }
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
      return apiError(result.error!, 400);
    }

    return apiOk({ responded: true });
  } catch (e) {
    return handleApiError(e);
  }
}
