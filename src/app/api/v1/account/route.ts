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
import { getCorsHeaders, withCors } from "../_helpers/cors";
import { rateLimit } from "@/server/lib/rateLimit";

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser(request);

    const rl = await rateLimit("accountUpdate", user.id);
    if (!rl.success) {
      return withCors(
        apiError(
          `Too many profile updates. Try again in ${rl.retryAfter} seconds.`,
          429,
          "RATE_LIMITED",
        ),
        request.headers.get("origin"),
      );
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(
        apiError("Validation failed", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    await userRepository.update(user.id, {
      displayName: parsed.data.displayName,
      region: parsed.data.region || null,
      bio: parsed.data.bio || null,
    });

    return withCors(
      apiOk({ user: { id: user.id, ...parsed.data } }),
      request.headers.get("origin"),
    );
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
