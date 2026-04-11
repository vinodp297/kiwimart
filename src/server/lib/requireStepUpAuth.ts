// src/server/lib/requireStepUpAuth.ts
// ─── Step-Up MFA Enforcement ─────────────────────────────────────────────────
// High-risk operations (admin refunds, account deletion, password changes) must
// be preceded by a fresh TOTP verification within the last 5 minutes.
//
// Flow:
//   1. User calls POST /api/v1/auth/mfa/step-up with their TOTP code + action.
//   2. Server verifies TOTP and sets Redis key mfa:step_up:{userId}:{action}
//      with a 300-second TTL.
//   3. Protected action calls requireStepUpAuth(userId, action) to gate entry.
//   4. On success the key is deleted (single-use).
//
// Fail-closed: if Redis is unavailable, the check throws so the action is
// blocked rather than silently permitted.

import { getRedisClient } from "@/infrastructure/redis/client";
import { AppError } from "@/shared/errors";

export const STEP_UP_TTL_SECONDS = 300; // 5 minutes

function stepUpKey(userId: string, action: string): string {
  return `mfa:step_up:${userId}:${action}`;
}

/**
 * Mark a step-up MFA verification for a user + action.
 * Called by the step-up endpoint after successful TOTP verification.
 */
export async function markStepUpVerified(
  userId: string,
  action: string,
): Promise<void> {
  const redis = getRedisClient();
  await redis.set(stepUpKey(userId, action), "1", { ex: STEP_UP_TTL_SECONDS });
}

/**
 * Assert that the user has completed step-up MFA for this action within the
 * last 5 minutes. Consumes the token (single-use).
 *
 * Throws AppError (403) if the step-up has not been completed or has expired.
 */
export async function requireStepUpAuth(
  userId: string,
  action: string,
): Promise<void> {
  const redis = getRedisClient();
  const key = stepUpKey(userId, action);
  const value = await redis.get(key);

  if (!value) {
    throw new AppError(
      "STEP_UP_REQUIRED",
      "This action requires a recent MFA verification. Please re-authenticate.",
      403,
    );
  }

  // Consume the token — single-use prevents replay within the TTL window.
  await redis.del(key);
}
