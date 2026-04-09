// src/app/api/v1/users/me/route.ts
// ─── Current User API ───────────────────────────────────────────────────────

import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";
import { userService } from "@/modules/users/user.service";

export async function GET(request: Request) {
  try {
    const sessionUser = await requireApiUser(request);

    const user = await userService.getApiProfile(sessionUser.id);

    if (!user) {
      return withCors(
        apiError("User not found", 404, "NOT_FOUND"),
        request.headers.get("origin"),
      );
    }

    return withCors(apiOk(user), request.headers.get("origin"));
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
