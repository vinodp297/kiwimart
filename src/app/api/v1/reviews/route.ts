// src/app/api/v1/reviews/route.ts
// ─── Reviews API ─────────────────────────────────────────────────────────────
// POST /api/v1/reviews — create a review for a completed order

import { createReviewSchema } from "@/server/validators";
import { reviewService } from "@/modules/reviews/review.service";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../_helpers/response";
import { corsHeaders } from "../_helpers/cors";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);

    const body = await request.json().catch(() => null);
    if (!body) {
      return apiError("Invalid request body", 400, "VALIDATION_ERROR");
    }

    const parsed = createReviewSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Validation failed", 400, "VALIDATION_ERROR");
    }

    const result = await reviewService.createReview(parsed.data, user.id);
    return apiOk(result, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
