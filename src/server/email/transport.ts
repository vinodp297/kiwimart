// src/server/email/transport.ts
// ─── Email Transport Layer ────────────────────────────────────────────────────
// Sends via Resend when RESEND_API_KEY is set; logs to console otherwise.
// Swap this file to change email provider without touching any template code.

import { getEmailClient, EMAIL_FROM } from '@/infrastructure/email/client';

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
    // Dev mode — print to console so email content is visible during development
    console.log('\n📧 ─────────────────────────────────────────');
    console.log(`📧 TO:      ${to}`);
    console.log(`📧 SUBJECT: ${subject}`);
    console.log('📧 [Email logged — add RESEND_API_KEY to .env.local to send]');
    console.log('📧 ─────────────────────────────────────────\n');
    return { success: true, dev: true };
  }

  try {
    const fromAddress = EMAIL_FROM;
    const { error } = await client.emails.send({ from: fromAddress, to, subject, html });
    if (error) {
      console.error('[EMAIL] Resend error:', error);
      return { success: false };
    }
    console.log(`[EMAIL] ✓ Sent "${subject}" → ${to}`);
    return { success: true };
  } catch (err) {
    console.error('[EMAIL] Transport failed:', err);
    return { success: false };
  }
}
