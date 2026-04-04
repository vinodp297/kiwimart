// src/app/api/v1/offers/route.ts
// ─── Offers API ──────────────────────────────────────────────────────────────
// POST /api/v1/offers — create a new offer on a listing

import { createOfferSchema } from "@/server/validators";
import { offerService } from "@/modules/offers/offer.service";
import { getClientIp } from "@/server/lib/rateLimit";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../_helpers/response";
import { corsHeaders } from "../_helpers/cors";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "offer");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);

    const body = await request.json().catch(() => null);
    if (!body) {
      return apiError("Invalid request body", 400, "VALIDATION_ERROR");
    }

    const parsed = createOfferSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Validation failed", 400, "VALIDATION_ERROR");
    }

    const ip = getClientIp(new Headers(request.headers)) || "unknown";
    const result = await offerService.createOffer(parsed.data, user.id, ip);
    return apiOk(result, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
