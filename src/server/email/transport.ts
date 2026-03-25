// src/server/email/transport.ts
// ─── Email Transport Layer ────────────────────────────────────────────────────
// Sends via Resend when RESEND_API_KEY is set; logs via logger otherwise.

import { getEmailClient, EMAIL_FROM } from '@/infrastructure/email/client';
import { logger } from '@/shared/logger';

export async function sendTransactionalEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; dev?: boolean }> {
  const client = getEmailClient();

  if (!client) {
    // Dev mode — log email info so content is visible during development
    logger.info('email.dev.logged', { to, subject });
    return { success: true, dev: true };
  }

  try {
    const fromAddress = EMAIL_FROM;
    const { error } = await client.emails.send({ from: fromAddress, to, subject, html });
    if (error) {
      logger.error('email.send.failed', { to, subject, error: String(error) });
      return { success: false };
    }
    logger.info('email.sent', { to, subject });
    return { success: true };
  } catch (err) {
    logger.error('email.transport.failed', { to, subject, error: err instanceof Error ? err.message : String(err) });
    return { success: false };
  }
}
