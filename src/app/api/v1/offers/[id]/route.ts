// src/app/api/v1/offers/[id]/route.ts
// ─── Offer Response API ─────────────────────────────────────────────────────
// PATCH /api/v1/offers/[id] — accept or decline an offer

import { z } from "zod";
import { offerService } from "@/modules/offers/offer.service";
import { getClientIp, rateLimit } from "@/server/lib/rateLimit";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";

const respondBodySchema = z.object({
  action: z.enum(["ACCEPT", "DECLINE"]),
  declineReason: z.string().max(300).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);

    const rl = await rateLimit("offerRespond", user.id);
    if (!rl.success) {
      return withCors(
        apiError(
          `Too many offer responses. Try again in ${rl.retryAfter} seconds.`,
          429,
          "RATE_LIMITED",
        ),
        request.headers.get("origin"),
      );
    }

    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const parsed = respondBodySchema.safeParse(body);
    if (!parsed.success) {
      return withCors(
        apiError("Validation failed", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const ip = getClientIp(new Headers(request.headers)) || "unknown";

    await offerService.respondOffer(
      { offerId: id, ...parsed.data },
      user.id,
      ip,
    );

    return withCors(apiOk(null), request.headers.get("origin"));
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
