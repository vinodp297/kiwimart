// src/app/api/v1/account/delete/route.ts
// ─── Account Deletion — NZ Privacy Act 2020 ──────────────────────────────────
// Permanently anonymises the user account. Requires password confirmation.
// Creates an immutable ErasureLog record for compliance.

import { performAccountErasure } from "@/modules/users/erasure.service";
import { userRepository } from "@/modules/users/user.repository";
import { verifyPassword } from "@/server/lib/password";
import { AppError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { apiOk, apiError, requireApiUser } from "../../_helpers/response";
import { withCors, getCorsHeaders } from "../../_helpers/cors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);

    // Parse and validate body
    const body = await request.json().catch(() => null);
    if (!body?.password) {
      return withCors(
        apiError(
          "Password confirmation is required to delete your account.",
          400,
          "VALIDATION_ERROR",
        ),
        request.headers.get("origin"),
      );
    }

    // Verify current password
    const userRecord = await userRepository.findPasswordHash(user.id);
    if (!userRecord?.passwordHash) {
      return withCors(
        apiError(
          "Password verification is not available for social login accounts. Please contact support.",
          400,
          "NO_PASSWORD",
        ),
        request.headers.get("origin"),
      );
    }

    const isPasswordValid = await verifyPassword(
      userRecord.passwordHash,
      body.password,
    );
    if (!isPasswordValid) {
      return withCors(
        apiError("Incorrect password.", 401, "INVALID_PASSWORD"),
        request.headers.get("origin"),
      );
    }

    // Perform the erasure
    await performAccountErasure({
      userId: user.id,
      operatorId: "self-service",
    });

    return withCors(apiOk({ success: true }), request.headers.get("origin"));
  } catch (e) {
    if (e instanceof AppError) {
      return withCors(
        apiError(e.message, e.statusCode, e.code),
        request.headers.get("origin"),
      );
    }

    logger.error("api.error", {
      path: "/api/v1/account/delete",
      error: e instanceof Error ? e.message : e,
    });

    return withCors(
      apiError("Failed to delete account. Please try again.", 500),
      request.headers.get("origin"),
    );
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
