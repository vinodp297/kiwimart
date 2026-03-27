// src/server/lib/turnstile.ts
// ─── Shared Cloudflare Turnstile Verification ─────────────────────────────────
// Single authoritative implementation used by ALL auth flows:
// login (lib/auth.ts), registration (server/actions/auth.ts),
// password reset (server/actions/auth.ts), and auth.service.ts.
//
// Fail behaviour (in production with a real key):
//   • Token absent/empty   → callers must reject before even calling here
//   • Test keys (1x/2x)    → warn loudly, allow through (test environments)
//   • Network error/timeout → return false — FAIL CLOSED
//   • API returns !ok       → return false — FAIL CLOSED
//   • API returns success:false → return false
//   • API returns success:true  → return true
//
// Non-production always returns true — no real bot challenges in dev/test.

import { logger } from '@/shared/logger'

/**
 * Verify a Cloudflare Turnstile challenge token server-side.
 *
 * Returns true if the token is valid, or if verification is not required
 * (non-production environment, or test key configured).
 *
 * Returns false on any failure — callers MUST reject the request on false.
 *
 * @param token - The Turnstile widget response token from the browser
 */
export async function verifyTurnstile(token: string): Promise<boolean> {
  // Always pass in non-production — no real challenges in dev/test
  if (process.env.NODE_ENV !== 'production') {
    return true
  }

  const secretKey =
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY ??
    process.env.TURNSTILE_SECRET_KEY

  // Test keys (1x/2x prefix) auto-pass all challenges — zero bot protection.
  // Warn loudly and allow through; operators must configure real keys before launch.
  if (!secretKey || secretKey.startsWith('1x') || secretKey.startsWith('2x')) {
    logger.warn(
      'turnstile: test/missing key in production — bot verification is DISABLED. ' +
        'Configure real keys at https://dash.cloudflare.com/turnstile'
    )
    return true
  }

  try {
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secretKey, response: token }),
        // 5-second timeout — Turnstile API is normally <200ms
        signal: AbortSignal.timeout(5000),
      }
    )

    if (!response.ok) {
      logger.warn('turnstile: Cloudflare API returned non-2xx status', {
        status: response.status,
      })
      return false // Fail closed on API error
    }

    const data = (await response.json()) as { success: boolean }
    return data.success === true
  } catch (e) {
    // Network error, DNS failure, or AbortError (5s timeout) — fail CLOSED
    logger.warn('turnstile: verification request failed (network/timeout)', {
      error: e instanceof Error ? e.message : String(e),
    })
    return false
  }
}
