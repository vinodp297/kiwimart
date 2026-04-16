// src/server/lib/verifyCronSecret.ts
// ─── Shared Cron Auth Guard ─────────────────────────────────────────────────
// Fail-closed: returns an error response if CRON_SECRET is unset or mismatched.
// Usage:
//   const authError = verifyCronSecret(request)
//   if (authError) return authError

import { NextResponse } from "next/server";
import { logger } from "@/shared/logger";
import { verifyBearerSecret } from "./verifyBearerSecret";
import { env } from "@/env";

/**
 * Verifies the Authorization header matches the CRON_SECRET env var.
 * Uses a timing-safe comparison to prevent timing-oracle attacks on the secret.
 * Returns a NextResponse error if unauthorized, or null if authorized.
 */
export function verifyCronSecret(request: Request): NextResponse | null {
  const cronSecret = env.CRON_SECRET;

  const authHeader = request.headers.get("authorization");
  const isValid = verifyBearerSecret(authHeader, cronSecret, "cron");

  if (!isValid) {
    logger.warn("cron.auth: unauthorized request", {
      path: request.url,
      ip: request.headers.get("x-real-ip") ?? "unknown",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null; // Authorized — proceed
}
