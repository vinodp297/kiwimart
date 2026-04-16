// src/server/email/transport.ts
// ─── Email Transport Layer ────────────────────────────────────────────────────
// Sends via Resend when RESEND_API_KEY is set; logs to console in dev/test.
//
// IMPORTANT: this function THROWS on failure so callers' try/catch blocks
// can log the error and surface it properly.  Previously it returned
// { success: false } silently, which made all email failures invisible.

import { getEmailClient } from "@/infrastructure/email/client";
import { logger } from "@/shared/logger";
import { env } from "@/env";

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

export async function sendTransactionalEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ id?: string }> {
  const client = getEmailClient();

  // Always read from env fresh — never rely on a module-level constant
  // that could have been captured before the env var was available.
  const from = env.EMAIL_FROM;

  if (!client) {
    if (env.NODE_ENV === "production") {
      // Hard failure in production — RESEND_API_KEY is not configured.
      throw new Error(
        "Email client not initialised: RESEND_API_KEY is missing or set to a placeholder value",
      );
    }
    // Dev / test mode — just log so email content is visible without sending.
    logger.info("email.dev.logged", { to: redactEmail(to), subject, from });
    return {};
  }

  // Pre-send log — makes it easy to verify the send is attempted in Vercel logs.
  logger.info("email.sending", { to: redactEmail(to), subject, from });

  const { data, error } = await client.emails.send({ from, to, subject, html });

  if (error) {
    // Log the full Resend error and THROW so callers know the send failed.
    logger.error("email.send.failed", {
      to: redactEmail(to),
      subject,
      from,
      resendError: String(error),
    });
    throw new Error(`Resend rejected the email: ${String(error)}`);
  }

  // Post-send success log — the id lets you look it up in the Resend dashboard.
  logger.info("email.sent", { to: redactEmail(to), subject, id: data?.id });
  return { id: data?.id };
}
