"use server";
// src/server/actions/mfaLogin.ts
// ─── MFA Login Verification ─────────────────────────────────────────────────
// Called from /auth/mfa-verify after password login succeeds but MFA is pending.

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { audit } from "@/server/lib/audit";
import { verifyMfaLogin } from "@/modules/auth/mfa.service";
import { markMfaVerified } from "@/server/lib/mfaSession";
import { safeActionError } from "@/shared/errors";
import type { ActionResult } from "@/types";

export async function verifyMfaLoginAction(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated." };
    }

    const code =
      typeof raw === "object" && raw !== null && "code" in raw
        ? String((raw as { code: string }).code)
        : "";

    if (!code || code.length < 1) {
      return { success: false, error: "Code is required." };
    }

    const ip = getClientIp(await headers());
    const limit = await rateLimit("auth", `mfa-login:${session.user.id}`);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many attempts. Please try again in a few minutes.",
      };
    }

    const result = await verifyMfaLogin(session.user.id, code);
    if (!result.verified) {
      audit({
        userId: session.user.id,
        action: "USER_LOGIN",
        metadata: { mfa: "failed", ip },
      });
      return { success: false, error: "Invalid code. Please try again." };
    }

    // Get the current JWT's jti from the session token
    // We need to use the auth() to get token info — but session doesn't expose jti.
    // Instead, we store by userId — the JWT callback will clear mfaPending on next request.
    // Use a userId-based key since we can't access jti from the session callback.
    await markMfaVerified(`user:${session.user.id}`);

    audit({
      userId: session.user.id,
      action: "USER_LOGIN",
      metadata: {
        mfa: "verified",
        backupCodeUsed: result.backupCodeUsed,
        ip,
      },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "MFA verification failed."),
    };
  }
}
