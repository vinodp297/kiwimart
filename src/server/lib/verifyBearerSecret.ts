// src/server/lib/verifyBearerSecret.ts
// ─── Shared Timing-Safe Bearer Token Verification ───────────────────────────
// Reused by cron, worker, and any internal endpoints that authenticate
// via a shared secret in the Authorization header.
//
// Uses constant-time comparison to prevent timing-oracle attacks.

import { timingSafeEqual } from 'crypto'
import { logger } from '@/shared/logger'

/**
 * Verifies an Authorization header matches `Bearer <secret>` using
 * timing-safe comparison. Returns false (and logs) if the secret env
 * var is missing, the header is absent, or the values don't match.
 */
export function verifyBearerSecret(
  authHeader: string | null,
  secret: string | undefined,
  context: string = 'endpoint'
): boolean {
  if (!secret) {
    logger.error(`verifyBearerSecret: secret not configured for ${context}`)
    return false
  }

  if (!authHeader) return false

  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(authHeader)

  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}
