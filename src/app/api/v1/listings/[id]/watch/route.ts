// src/app/api/v1/listings/[id]/watch/route.ts
// ─── Watchlist Toggle ────────────────────────────────────────────────────────
// POST /api/v1/listings/[id]/watch — toggle watchlist for the listing

import { listingService } from "@/modules/listings/listing.service";
import {
  apiOk,
  handleApiError,
  requireApiUser,
} from "../../../_helpers/response";
import { corsHeaders } from "../../../_helpers/cors";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await params;

    const result = await listingService.toggleWatch(id, user.id);
    return apiOk(result);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
