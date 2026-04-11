// src/server/lib/turnstile.ts
// ─── Shared Cloudflare Turnstile Verification ─────────────────────────────────
// Single authoritative implementation used by ALL auth flows:
// login (lib/auth.ts), registration (server/actions/auth.ts),
// password reset (server/actions/auth.ts), and auth.service.ts.
//
// Fail behaviour (in production with a real key):
//   • Token absent/empty   → callers must reject before even calling here
//   • Test keys (1x/2x)    → fail closed in production
//   • Network error/timeout → return false — FAIL CLOSED
//   • API returns !ok       → return false — FAIL CLOSED
//   • API returns success:false → return false
//   • API returns success:true  → return true
//
// Non-production always returns true — no real bot challenges in dev/test.

import { logger } from "@/shared/logger";

/**
 * Verify a Cloudflare Turnstile challenge token server-side.
 *
 * Returns true if the token is valid, or if verification is not required
 * (non-production environment).
 *
 * Returns false on any failure — callers MUST reject the request on false.
 *
 * @param token - The Turnstile widget response token from the browser
 * @param remoteIp - Optional client IP address (helps Cloudflare validate)
 */
export async function verifyTurnstile(
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  // Turnstile enforcement is opt-in via TURNSTILE_ENFORCED. Replaces the prior
  // NODE_ENV !== "production" check which silently bypassed verification on
  // staging environments using NODE_ENV=staging or =preview.
  const enforced = process.env.TURNSTILE_ENFORCED === "true";
  if (!enforced) {
    return true;
  }

  const secretKey =
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY ??
    process.env.TURNSTILE_SECRET_KEY;

  // Fail closed in production when key is missing
  if (!secretKey) {
    logger.error(
      "turnstile: secret key MISSING in production — rejecting request. " +
        "Set CLOUDFLARE_TURNSTILE_SECRET_KEY in environment variables.",
    );
    return false;
  }

  // Fail closed in production when using test keys (1x/2x prefix)
  if (secretKey.startsWith("1x") || secretKey.startsWith("2x")) {
    logger.error(
      "turnstile: Production Turnstile key is a test key — bot protection is disabled. " +
        "Configure real keys at https://dash.cloudflare.com/turnstile",
    );
    return false;
  }

  try {
    // Cloudflare siteverify expects application/x-www-form-urlencoded
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) {
      formData.append("remoteip", remoteIp);
    }

    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
        // 5-second timeout — Turnstile API is normally <200ms
        signal: AbortSignal.timeout(5000),
      },
    );

    // Read the body regardless of status — Cloudflare returns error details
    // in the JSON body even for non-2xx responses
    let data: { success: boolean; "error-codes"?: string[] };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      logger.warn("turnstile: failed to parse Cloudflare response body", {
        status: response.status,
      });
      return false;
    }

    if (!response.ok) {
      logger.warn("turnstile: Cloudflare API returned non-2xx status", {
        status: response.status,
        errorCodes: data["error-codes"] ?? [],
        success: data.success,
      });
      return false;
    }

    if (!data.success) {
      logger.warn("turnstile: Cloudflare rejected the token", {
        errorCodes: data["error-codes"] ?? [],
      });
      return false;
    }
    return true;
  } catch (e) {
    // Network error, DNS failure, or AbortError (5s timeout) — fail CLOSED
    logger.warn("turnstile: verification request failed (network/timeout)", {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}
