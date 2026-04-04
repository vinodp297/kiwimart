// src/app/api/v1/listings/[id]/watch/route.ts
// ─── Watchlist Toggle ────────────────────────────────────────────────────────
// POST /api/v1/listings/[id]/watch — toggle watchlist for the listing

import { listingService } from "@/modules/listings/listing.service";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../../../_helpers/response";
import { corsHeaders, withCors } from "../../../_helpers/cors";
import { rateLimit } from "@/server/lib/rateLimit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);

    const rl = await rateLimit("watch", user.id);
    if (!rl.success) {
      return withCors(
        apiError(
          `Too many watchlist actions. Try again in ${rl.retryAfter} seconds.`,
          429,
          "RATE_LIMITED",
        ),
      );
    }

    const { id } = await params;

    const result = await listingService.toggleWatch(id, user.id);
    return withCors(apiOk(result));
  } catch (e) {
    return withCors(handleApiError(e));
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
