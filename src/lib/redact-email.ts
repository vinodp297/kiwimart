// src/lib/redact-email.ts
// ─── Email redaction utility ──────────────────────────────────────────────────
// Pure string function — no external imports so it can be used by both the
// logger core and the email transport layer without circular dependencies.

/**
 * Redacts an email address for safe logging.
 * e.g. "user@example.com" → "u***@example.com"
 * Edge cases: no "@" → "***", single-char local → "a***@domain"
 */
export function redactEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return "***";
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  return `${local.charAt(0)}***@${domain}`;
}
