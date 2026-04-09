// src/lib/log-sanitiser.ts
// ─── PII Sanitiser for Structured Logs ──────────────────────────────────────
// Redacts personally identifiable information from log context objects before
// they are passed to the structured logger.
//
// Fields auto-redacted:
//   • email / *Email / *_email  → first char + *** + @domain
//   • phone / *Phone / *_phone  → digits masked except last 4
//
// Usage:
//   logger.info("some.event", sanitiseLogContext({ email, orderId }))

import { redactEmail } from "@/server/email/transport";

/**
 * Redacts PII fields in a log context object.
 * Returns a shallow copy with email/phone fields masked.
 */
export function sanitiseLogContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      // Redact email fields
      if (
        (key === "email" ||
          key === "to" ||
          key.endsWith("Email") ||
          key.endsWith("_email")) &&
        typeof value === "string" &&
        value.includes("@")
      ) {
        return [key, redactEmail(value)];
      }
      // Redact phone fields
      if (
        (key === "phone" || key.endsWith("Phone") || key.endsWith("_phone")) &&
        typeof value === "string"
      ) {
        return [key, value.replace(/\d(?=\d{4})/g, "*")];
      }
      return [key, value];
    }),
  );
}
