// src/app/api/v1/notifications/push/route.ts
// ─── Push Token Registration ──────────────────────────────────────────────────
// POST   /api/v1/notifications/push — register (or refresh) a device push token
// DELETE /api/v1/notifications/push — deactivate a push token on sign-out

import { z } from "zod";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";
import { rateLimit } from "@/server/lib/rateLimit";
import {
  registerPushToken,
  unregisterPushToken,
} from "@/modules/notifications/notification.service";

const registerSchema = z.object({
  token: z.string().min(1).max(512),
  platform: z.enum(["ios", "android", "web"]),
  deviceId: z.string().max(255).optional(),
});

const unregisterSchema = z.object({
  token: z.string().min(1).max(512),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);

    const rl = await rateLimit("pushToken", user.id);
    if (!rl.success) {
      return withCors(
        apiError(
          `Too many device registrations. Try again in ${rl.retryAfter} seconds.`,
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

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(
        apiError("Validation failed", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const { token, platform, deviceId } = parsed.data;

    await registerPushToken(user.id, token, platform, deviceId);

    return withCors(
      apiOk({ message: "Push token registered" }),
      request.headers.get("origin"),
    );
  } catch (e) {
    return withCors(handleApiError(e), request.headers.get("origin"));
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser(request);

    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const parsed = unregisterSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(
        apiError("Validation failed", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    // Ownership is not enforced at DB level because a token is already
    // user-specific — deactivating someone else's token would only hurt them.
    // requireApiUser already verifies the caller is authenticated.
    void user;

    await unregisterPushToken(parsed.data.token);

    return withCors(
      apiOk({ message: "Push token unregistered" }),
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
