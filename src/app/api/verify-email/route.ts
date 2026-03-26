// src/app/api/verify-email/route.ts
// ─── Email Verification Token Handler ────────────────────────────────────────
// GET /api/verify-email?token=<hex>
// Validates token, marks email as verified, sends welcome email, redirects.

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getEmailClient, EMAIL_FROM } from '@/infrastructure/email/client';
import { logger } from '@/shared/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://kiwimart.vercel.app';

  if (!token) {
    return NextResponse.redirect(new URL('/verify-email?error=invalid', request.url));
  }

  // Look up user by token (also check not expired)
  const user = await db.user.findFirst({
    where: {
      emailVerifyToken: token,
      emailVerifyExpires: { gt: new Date() },
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      emailVerified: true,
    },
  });

  if (!user) {
    return NextResponse.redirect(new URL('/verify-email?error=invalid', request.url));
  }

  if (user.emailVerified) {
    // Already verified — just send them to login
    return NextResponse.redirect(new URL('/login?verified=true', request.url));
  }

  // Mark email as verified and clear the token
  await db.user.update({
    where: { id: user.id },
    data: {
      emailVerified: new Date(),
      emailVerifyToken: null,
      emailVerifyExpires: null,
    },
  });

  // Send welcome email (fire-and-forget; don't block the redirect)
  const resend = getEmailClient();
  if (resend) {
    resend.emails
      .send({
        from: EMAIL_FROM,
        to: user.email ?? '',
        subject: `Welcome to KiwiMart, ${user.displayName}! 🥝`,
        html: buildWelcomeEmail({ name: user.displayName ?? 'there', appUrl }),
      })
      .catch((err) => logger.error('email.welcome.failed', { error: err }));
  }

  return NextResponse.redirect(new URL('/login?verified=true', request.url));
}

function buildWelcomeEmail({ name, appUrl }: { name: string; appUrl: string }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#FAFAF8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E3E0D9;overflow:hidden">
  <div style="background:#141414;padding:28px 32px">
    <p style="margin:0;color:#D4A843;font-size:22px;font-weight:700">🥝 Welcome to KiwiMart!</p>
    <p style="margin:6px 0 0;color:#888;font-size:12px">New Zealand's Trust-First Marketplace</p>
  </div>
  <div style="padding:32px">
    <p style="margin:0 0 16px;color:#141414;font-size:16px;font-weight:600">Hi ${name}, your email is verified! 🎉</p>
    <p style="margin:0 0 24px;color:#73706A;font-size:14px;line-height:1.7">
      Your KiwiMart account is ready. Here's what you can do:
    </p>
    <div style="background:#FAFAF8;border-radius:12px;padding:16px;margin-bottom:24px">
      <p style="margin:0 0 10px;font-size:14px;color:#141414">🛍️ <strong>Browse listings</strong> — thousands of NZ items with buyer protection</p>
      <p style="margin:0 0 10px;font-size:14px;color:#141414">💰 <strong>Sell your items</strong> — free to list, paid securely via escrow</p>
      <p style="margin:0;font-size:14px;color:#141414">🛡️ <strong>Every purchase protected</strong> — payment held until you confirm delivery</p>
    </div>
    <div style="text-align:center">
      <a href="${appUrl}" style="background:#D4A843;color:#141414;padding:14px 36px;border-radius:50px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
        Start exploring →
      </a>
    </div>
  </div>
  <div style="background:#FAFAF8;padding:16px 32px;border-top:1px solid #E3E0D9;text-align:center">
    <p style="margin:0;color:#C9C5BC;font-size:11px">Questions? Email us at support@kiwimart.co.nz</p>
  </div>
</div>
</body>
</html>`;
}
