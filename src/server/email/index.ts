// src/server/email/index.ts
// ─── Transactional Email — Postmark ──────────────────────────────────────────
// Uses Postmark for transactional email delivery.
// All templates are plain-text + HTML (generated inline — React Email in Sprint 5).
//
// Why Postmark:
//   • Purpose-built for transactional (not marketing) email
//   • Best deliverability in NZ/AU market
//   • Detailed message stream tracking
//   • Free tier: 100 emails/month
//
// Security:
//   • Server token kept server-side only (never in client bundle)
//   • All emails HTML-escaped before insertion
//   • Unsubscribe links included in marketing emails (NZ Unsolicited Electronic
//     Messages Act 2007)

import { ServerClient } from 'postmark';

// Lazily initialised to avoid errors in test environments
let client: ServerClient | null = null;

function getPostmarkClient(): ServerClient {
  if (!client) {
    const token = process.env.POSTMARK_SERVER_TOKEN;
    if (!token) {
      throw new Error('Missing POSTMARK_SERVER_TOKEN environment variable.');
    }
    client = new ServerClient(token);
  }
  return client;
}

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'KiwiMart <noreply@kiwimart.co.nz>';
const REPLY_TO = 'support@kiwimart.co.nz';

// ── Helper: HTML-escape ───────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Base HTML template ────────────────────────────────────────────────────────

function baseTemplate(content: string, previewText: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(previewText)}</title>
  <style>
    body { margin:0; padding:0; background:#F8F7F4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#141414; }
    .wrapper { max-width:580px; margin:0 auto; padding:32px 16px; }
    .card { background:#fff; border-radius:16px; border:1px solid #E3E0D9; overflow:hidden; }
    .header { background:#141414; padding:24px 32px; }
    .logo { font-size:20px; color:#D4A843; font-weight:700; letter-spacing:-0.5px; }
    .body { padding:32px; }
    h1 { font-size:22px; font-weight:700; margin:0 0 12px; line-height:1.3; }
    p { font-size:14px; line-height:1.7; color:#73706A; margin:0 0 16px; }
    .btn { display:inline-block; background:#D4A843; color:#141414; font-size:14px;
      font-weight:700; text-decoration:none; padding:12px 28px;
      border-radius:999px; margin:8px 0 24px; }
    .divider { border:0; border-top:1px solid #F0EDE8; margin:24px 0; }
    .footer { padding:24px 32px; text-align:center; font-size:11px; color:#C9C5BC; }
    .trust { background:#F5ECD4; border:1px solid rgba(212,168,67,.3);
      border-radius:12px; padding:14px 18px; font-size:13px; color:#8B6914;
      margin:16px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="logo">🥝 KiwiMart</div>
      </div>
      <div class="body">${content}</div>
    </div>
    <div class="footer">
      KiwiMart Limited · Auckland, New Zealand<br>
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe" style="color:#C9C5BC;">Unsubscribe</a> ·
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/privacy" style="color:#C9C5BC;">Privacy Policy</a>
    </div>
  </div>
</body>
</html>`;
}

// ── Email functions ───────────────────────────────────────────────────────────

export async function sendWelcomeEmail(params: {
  to: string;
  displayName: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Welcome to KiwiMart, ${esc(params.displayName)}! 🥝</h1>
    <p>You're now part of Aotearoa's most trusted marketplace. Millions of Kiwis buy and sell here — and now so can you.</p>
    <p>Here's what you can do right now:</p>
    <p><strong>🔍 Browse listings</strong> — find great deals from NZ sellers near you.</p>
    <p><strong>📦 List an item</strong> — sell in under 2 minutes, $0 listing fee.</p>
    <p><strong>🛡 $3,000 protection</strong> — every purchase backed by KiwiMart's buyer protection.</p>
    <a href="${process.env.NEXT_PUBLIC_APP_URL}" class="btn">Start exploring →</a>
    <div class="trust">Your account is protected by secure escrow payments and ID-verified sellers.</div>`,
    `Welcome to KiwiMart, ${params.displayName}!`
  );

  await getPostmarkClient().sendEmail({
    From: FROM_ADDRESS,
    To: params.to,
    ReplyTo: REPLY_TO,
    Subject: `Welcome to KiwiMart, ${params.displayName}! 🥝`,
    HtmlBody: html,
    TextBody: `Welcome to KiwiMart!\n\nYou're now part of Aotearoa's most trusted marketplace.\n\nBrowse listings at ${process.env.NEXT_PUBLIC_APP_URL}\n\nKiwiMart Team`,
    MessageStream: 'outbound',
    TrackOpens: true,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  displayName: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Reset your password</h1>
    <p>Hi ${esc(params.displayName)}, we received a request to reset your KiwiMart password.</p>
    <p>Click the button below to set a new password. This link expires in <strong>${params.expiresInMinutes} minutes</strong>.</p>
    <a href="${esc(params.resetUrl)}" class="btn">Reset my password →</a>
    <hr class="divider">
    <p style="font-size:12px;">If you didn't request this, ignore this email — your password won't change. If you're worried about your account, <a href="${process.env.NEXT_PUBLIC_APP_URL}/support" style="color:#D4A843;">contact support</a>.</p>
    <p style="font-size:11px; color:#C9C5BC;">For security, this link can only be used once and expires after ${params.expiresInMinutes} minutes.</p>`,
    'Reset your KiwiMart password'
  );

  await getPostmarkClient().sendEmail({
    From: FROM_ADDRESS,
    To: params.to,
    ReplyTo: REPLY_TO,
    Subject: 'Reset your KiwiMart password',
    HtmlBody: html,
    TextBody: `Hi ${params.displayName},\n\nReset your KiwiMart password:\n${params.resetUrl}\n\nThis link expires in ${params.expiresInMinutes} minutes.\n\nIf you didn't request this, ignore this email.\n\nKiwiMart Team`,
    MessageStream: 'outbound',
  });
}

export async function sendOfferReceivedEmail(params: {
  to: string;
  sellerName: string;
  buyerName: string;
  listingTitle: string;
  offerAmount: number;
  listingUrl: string;
}): Promise<void> {
  const formatted = `$${params.offerAmount.toLocaleString('en-NZ')}`;
  const html = baseTemplate(
    `<h1>You've received an offer! 🎉</h1>
    <p>Hi ${esc(params.sellerName)}, <strong>${esc(params.buyerName)}</strong> has made an offer of <strong>${esc(formatted)}</strong> on your listing:</p>
    <p><strong>${esc(params.listingTitle)}</strong></p>
    <a href="${esc(params.listingUrl)}" class="btn">View offer →</a>
    <p style="font-size:12px; color:#9E9A91;">Offers expire after 48 hours. Sign in to accept or decline.</p>`,
    `You received a ${formatted} offer`
  );

  await getPostmarkClient().sendEmail({
    From: FROM_ADDRESS,
    To: params.to,
    Subject: `Offer received: ${formatted} for "${params.listingTitle}"`,
    HtmlBody: html,
    TextBody: `Hi ${params.sellerName},\n\n${params.buyerName} made an offer of ${formatted} on your listing "${params.listingTitle}".\n\nView and respond: ${params.listingUrl}\n\nKiwiMart Team`,
    MessageStream: 'outbound',
    TrackOpens: true,
    TrackLinks: 'HtmlOnly',
  });
}

export async function sendOfferResponseEmail(params: {
  to: string;
  buyerName: string;
  listingTitle: string;
  accepted: boolean;
  listingUrl: string;
}): Promise<void> {
  const subject = params.accepted
    ? `✅ Offer accepted — "${params.listingTitle}"`
    : `Offer update — "${params.listingTitle}"`;

  const html = baseTemplate(
    params.accepted
      ? `<h1>Your offer was accepted! 🎉</h1>
        <p>Hi ${esc(params.buyerName)}, great news — the seller has accepted your offer on <strong>${esc(params.listingTitle)}</strong>.</p>
        <p>Complete your purchase within <strong>24 hours</strong> to secure the item.</p>
        <a href="${esc(params.listingUrl)}" class="btn">Complete purchase →</a>
        <div class="trust">Your payment is protected by KiwiMart's $3,000 Buyer Protection. Funds are held in escrow until you confirm delivery.</div>`
      : `<h1>Offer update</h1>
        <p>Hi ${esc(params.buyerName)}, the seller has declined your offer on <strong>${esc(params.listingTitle)}</strong>.</p>
        <p>You can make a new offer or browse similar listings.</p>
        <a href="${esc(params.listingUrl)}" class="btn">View listing →</a>`,
    subject
  );

  await getPostmarkClient().sendEmail({
    From: FROM_ADDRESS,
    To: params.to,
    Subject: subject,
    HtmlBody: html,
    TextBody: params.accepted
      ? `Hi ${params.buyerName}, your offer on "${params.listingTitle}" was accepted! Complete your purchase: ${params.listingUrl}`
      : `Hi ${params.buyerName}, your offer on "${params.listingTitle}" was declined. View the listing: ${params.listingUrl}`,
    MessageStream: 'outbound',
    TrackOpens: true,
  });
}

export async function sendOrderDispatchedEmail(params: {
  to: string;
  buyerName: string;
  listingTitle: string;
  trackingNumber?: string;
  trackingUrl?: string;
  orderUrl: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Your item has been dispatched! 📦</h1>
    <p>Hi ${esc(params.buyerName)}, your order for <strong>${esc(params.listingTitle)}</strong> is on its way.</p>
    ${params.trackingNumber
      ? `<p>Tracking number: <strong>${esc(params.trackingNumber)}</strong>${params.trackingUrl ? ` — <a href="${esc(params.trackingUrl)}" style="color:#D4A843;">track your parcel</a>` : ''}</p>`
      : ''}
    <p>Once you receive and inspect your item, please confirm delivery in KiwiMart so the seller gets paid.</p>
    <a href="${esc(params.orderUrl)}" class="btn">View order →</a>
    <div class="trust">Your payment is held securely until you confirm receipt. Don't confirm delivery until you're happy with the item.</div>`,
    'Your order has been dispatched'
  );

  await getPostmarkClient().sendEmail({
    From: FROM_ADDRESS,
    To: params.to,
    Subject: `Your order has been dispatched — ${params.listingTitle}`,
    HtmlBody: html,
    TextBody: `Hi ${params.buyerName}, your order "${params.listingTitle}" has been dispatched. View order: ${params.orderUrl}`,
    MessageStream: 'outbound',
    TrackOpens: true,
  });
}

