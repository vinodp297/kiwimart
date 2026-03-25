// src/infrastructure/email/client.ts
// ─── Resend Email Client ──────────────────────────────────────────────────────
// Lazy Resend singleton with dev fallback.
// Returns null when RESEND_API_KEY is unset or placeholder — callers
// should log to console in dev mode when null is returned.

import { Resend } from 'resend'

let _client: Resend | null = null

/**
 * Returns the Resend client, or null in dev mode when no key is configured.
 * In production, callers should treat null as a hard error.
 */
export function getEmailClient(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (
    !key ||
    key === 're_placeholder' ||
    key === 'PLACEHOLDER' ||
    key.includes('placeholder')
  ) {
    return null // Dev mode — emails should be logged to console
  }
  if (!_client) {
    _client = new Resend(key)
  }
  return _client
}

export const EMAIL_FROM =
  process.env.EMAIL_FROM ?? 'KiwiMart <onboarding@resend.dev>'
