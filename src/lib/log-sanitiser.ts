// src/lib/log-sanitiser.ts
// ─── PII Sanitiser for Structured Logs ──────────────────────────────────────
// Recursively scrubs personally identifiable information from log context
// objects before they reach the structured logger.
//
// Redaction rules:
//   • email / *Email / *_email / to  → first char + *** + @domain  (redactEmail)
//   • phone / phoneNumber / *Phone / *_phone → digits masked except last 4
//   • All other PII_KEYS              → "[redacted]"
//
// Recursion:
//   • Plain nested objects are descended into (max depth 5)
//   • Arrays: each object element is recursed; primitives pass through as-is
//   • depth > 5 returns the sub-tree unchanged to prevent runaway recursion

import { redactEmail } from "@/server/email/transport";

// Exact-match key names that are always PII.
// Email/phone key patterns are handled separately with format-aware masking.
const PII_KEYS = new Set([
  "password",
  "token",
  "secret",
  "accessToken",
  "refreshToken",
  "apiKey",
  "cardNumber",
  "irdNumber",
  "bankAccount",
  "dateOfBirth",
  "address",
  "firstName",
  "lastName",
  "fullName",
  "name",
]);

function isEmailKey(key: string): boolean {
  return (
    key === "email" ||
    key === "to" ||
    key.endsWith("Email") ||
    key.endsWith("_email")
  );
}

function isPhoneKey(key: string): boolean {
  return (
    key === "phone" ||
    key === "phoneNumber" ||
    key.endsWith("Phone") ||
    key.endsWith("_phone")
  );
}

function redactValue(key: string, value: unknown): unknown {
  if (isEmailKey(key)) {
    return typeof value === "string" && value.includes("@")
      ? redactEmail(value)
      : value;
  }
  if (isPhoneKey(key)) {
    return typeof value === "string"
      ? value.replace(/\d(?=\d{4})/g, "*")
      : value;
  }
  return "[redacted]";
}

/**
 * Recursively redacts PII from a log context object.
 * The depth parameter is internal — callers should not supply it.
 */
export function sanitiseLogContext(
  ctx: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > 5) return ctx;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(ctx)) {
    if (isEmailKey(key) || isPhoneKey(key) || PII_KEYS.has(key)) {
      result[key] = redactValue(key, value);
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = sanitiseLogContext(
        value as Record<string, unknown>,
        depth + 1,
      );
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item !== null && typeof item === "object"
          ? sanitiseLogContext(item as Record<string, unknown>, depth + 1)
          : item,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}
