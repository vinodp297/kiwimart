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

// Pattern-based PII key detection — substring match, case-insensitive.
// Any field whose name contains one of these substrings is treated as PII.
// This catches compound names like "buyerEmail", "shippingAddress",
// "sellerFirstName", etc. without needing exact-match entries for every variant.
// Email/phone patterns are also listed here for completeness, but format-aware
// masking (partial redaction) is applied by isEmailKey/isPhoneKey first.
const PII_PATTERNS: readonly string[] = [
  "email",
  "phone",
  "password",
  "token",
  "secret",
  "key",
  "address",
  "firstName",
  "lastName",
  "fullName",
  "name",
  "cardNumber",
  "irdNumber",
  "bankAccount",
  "dateOfBirth",
  // Stripe identifiers — treated as PII under the Privacy Act
  "stripeCustomerId",
  "stripeAccountId",
  "paymentIntentId",
  "chargeId",
  "transferId",
  "payoutId",
];

/** Returns true if the field name contains any known PII pattern (case-insensitive). */
function isPiiKey(key: string): boolean {
  const lower = key.toLowerCase();
  return PII_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

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
    if (isEmailKey(key) || isPhoneKey(key) || isPiiKey(key)) {
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
