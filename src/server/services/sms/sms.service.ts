// src/server/services/sms/sms.service.ts
// ─── SMS Service ─────────────────────────────────────────────────────────────
// Sends SMS messages via Twilio when credentials are configured.
// Falls back to structured logging when credentials are absent (dev / CI).
//
// Required environment variables (all three must be non-empty for real SMS):
//   TWILIO_ACCOUNT_SID   — Account SID from console.twilio.com
//   TWILIO_AUTH_TOKEN    — Auth token from console.twilio.com
//   TWILIO_FROM_NUMBER   — Your Twilio number in E.164 format (+64…)
//
// Usage:
//   const { sendSms, formatNzPhoneE164 } = await import("@/server/services/sms/sms.service")
//   await sendSms({ to: formatNzPhoneE164(phone), body: "Your code is 123456" })

import { logger } from "@/shared/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SmsParams {
  to: string; // E.164 format, e.g. +64211234567
  body: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a New Zealand phone number to E.164 format (+64XXXXXXXXX).
 * Strips spaces, dashes, and parentheses before normalising.
 *
 * Examples:
 *   "021 123 4567"  → "+64211234567"
 *   "0211234567"    → "+64211234567"
 *   "+64211234567"  → "+64211234567"
 *   "64211234567"   → "+64211234567"
 */
export function formatNzPhoneE164(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("+64")) return cleaned;
  if (cleaned.startsWith("64")) return `+${cleaned}`;
  if (cleaned.startsWith("0")) return `+64${cleaned.slice(1)}`;
  // Already stripped — assume local number without leading zero
  return `+64${cleaned}`;
}

/**
 * Validate a New Zealand phone number (mobile or landline).
 * Accepts numbers with or without +64 / 64 country code prefix.
 * Strips spaces and dashes before testing.
 *
 * NZ mobiles:  021 / 022 / 027 / 028 / 029
 * NZ landlines: 03 / 04 / 06 / 07 / 09
 */
export function isValidNzPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  return /^(\+?64|0)(2[1-9]\d{6,8}|[3-9]\d{7})$/.test(cleaned);
}

// ── sendSms ───────────────────────────────────────────────────────────────────

/**
 * Send an SMS message.
 *
 * - When TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER are all
 *   non-empty: sends a real SMS via Twilio.
 * - When any of those variables is absent or empty: logs to the application
 *   logger instead (safe for development and CI environments).
 *
 * The OTP code is only included in the log output in development mode.
 * In production the log contains only the last 4 digits of the recipient's
 * number (privacy).
 */
export async function sendSms(params: SmsParams): Promise<void> {
  const { to, body } = params;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  const isConfigured =
    accountSid &&
    accountSid.length > 0 &&
    authToken &&
    authToken.length > 0 &&
    fromNumber &&
    fromNumber.length > 0;

  if (!isConfigured) {
    // Dev / CI — log instead of sending
    if (process.env.NODE_ENV === "development") {
      logger.info("sms.dev", { to, body });
    } else {
      // Non-production but missing creds — log without sensitive content
      logger.info("sms.no_credentials", { to: `****${to.slice(-4)}` });
    }
    return;
  }

  // Production — call Twilio
  try {
    const { default: Twilio } = await import("twilio");
    const client = Twilio(accountSid, authToken);
    await client.messages.create({ to, from: fromNumber!, body });
    logger.info("sms.sent", { to: `****${to.slice(-4)}` });
  } catch (err) {
    logger.error("sms.send_failed", {
      to: `****${to.slice(-4)}`,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
