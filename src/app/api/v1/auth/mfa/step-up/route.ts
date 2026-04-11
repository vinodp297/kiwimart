// src/app/api/v1/auth/mfa/step-up/route.ts
// ─── Step-Up MFA Verification ────────────────────────────────────────────────
// Verifies a TOTP code and grants a short-lived (5-minute) step-up token for
// a specific high-risk action. The token is stored in Redis and consumed by
// requireStepUpAuth() at the protected action site.
//
// POST body: { code: string, action: string }
// Supported actions: "refund", "account_delete", "password_change"

import { requireApiUser, apiOk, apiError } from "../../../_helpers/response";
import { verifyMfaLogin } from "@/modules/auth/mfa.service";
import { markStepUpVerified } from "@/server/lib/requireStepUpAuth";
import { withCors, getCorsHeaders } from "../../../_helpers/cors";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

const ALLOWED_ACTIONS = [
  "refund",
  "account_delete",
  "password_change",
] as const;
type StepUpAction = (typeof ALLOWED_ACTIONS)[number];

function isAllowedAction(action: string): action is StepUpAction {
  return (ALLOWED_ACTIONS as readonly string[]).includes(action);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  try {
    const user = await requireApiUser(request);

    const body = await request.json().catch(() => null);
    if (!body?.code || typeof body.code !== "string") {
      return withCors(
        apiError("TOTP code is required.", 400, "VALIDATION_ERROR"),
        origin,
      );
    }
    if (!body?.action || !isAllowedAction(body.action)) {
      return withCors(
        apiError(
          `Action must be one of: ${ALLOWED_ACTIONS.join(", ")}.`,
          400,
          "VALIDATION_ERROR",
        ),
        origin,
      );
    }

    const { verified } = await verifyMfaLogin(user.id, body.code as string);
    if (!verified) {
      logger.warn("step_up.invalid_code", {
        userId: user.id,
        action: body.action,
      });
      return withCors(
        apiError("Invalid or expired MFA code.", 401, "INVALID_MFA_CODE"),
        origin,
      );
    }

    await markStepUpVerified(user.id, body.action as StepUpAction);

    logger.info("step_up.verified", { userId: user.id, action: body.action });

    return withCors(
      apiOk({ action: body.action, expiresInSeconds: 300 }),
      origin,
    );
  } catch (e) {
    const err = e as { statusCode?: number; message?: string; code?: string };
    if (err.statusCode) {
      return withCors(
        apiError(err.message ?? "Unauthorised.", err.statusCode, err.code),
        origin,
      );
    }
    logger.error("step_up.error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return withCors(
      apiError("Step-up verification failed. Please try again.", 500),
      origin,
    );
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
