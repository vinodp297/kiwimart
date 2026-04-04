// src/app/api/v1/account/route.ts
// ─── Account API ─────────────────────────────────────────────────────────────
// PATCH /api/v1/account — update profile fields (display name, bio, region)

import { updateProfileSchema } from "@/server/validators";
import { userRepository } from "@/modules/users/user.repository";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../_helpers/response";
import { corsHeaders } from "../_helpers/cors";

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser(request);

    const body = await request.json().catch(() => null);
    if (!body) {
      return apiError("Invalid request body", 400, "VALIDATION_ERROR");
    }

    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Validation failed", 400, "VALIDATION_ERROR");
    }

    await userRepository.update(user.id, {
      displayName: parsed.data.displayName,
      region: parsed.data.region || null,
      bio: parsed.data.bio || null,
    });

    return apiOk({ user: { id: user.id, ...parsed.data } });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
