// src/infrastructure/email/client.ts
// ─── Resend Email Client ──────────────────────────────────────────────────────
// Returns a fresh Resend instance on every call — no singleton.
// On Vercel serverless each lambda invocation may share a warm process but
// caching a null instance would permanently break email if the env var was
// missing at first call. Always reading the key fresh avoids that.
// Returns null when RESEND_API_KEY is unset or a placeholder string —
// callers should log to console in dev mode when null is returned.

import { Resend } from "resend";

const PLACEHOLDER_VALUES = new Set([
  "re_placeholder",
  "placeholder",
  "PLACEHOLDER",
]);

/**
 * Returns a Resend client initialised with the current RESEND_API_KEY,
 * or null when the key is absent or a placeholder.
 * In production, callers should treat null as a hard error.
 */
export function getEmailClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (
    !key ||
    PLACEHOLDER_VALUES.has(key) ||
    key.toLowerCase().includes("placeholder")
  ) {
    return null; // Dev / unconfigured — emails are logged to console
  }
  return new Resend(key); // always fresh — no stale-singleton risk
}

export const EMAIL_FROM =
  process.env.EMAIL_FROM ?? "Buyzi <onboarding@resend.dev>";
