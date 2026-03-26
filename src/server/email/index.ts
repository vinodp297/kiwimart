// src/server/email/index.ts
// ─── Transactional Email ──────────────────────────────────────────────────────
// Transport layer: Resend (when RESEND_API_KEY is set) or console logging.
// All HTML templates are kept here; only the delivery mechanism changed from Postmark.

import { sendTransactionalEmail } from './transport';

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
    .btn-secondary { display:inline-block; background:#F8F7F4; color:#141414; font-size:14px;
      font-weight:600; text-decoration:none; padding:12px 28px;
      border-radius:999px; margin:8px 0 24px; border:1px solid #E3E0D9; }
    .divider { border:0; border-top:1px solid #F0EDE8; margin:24px 0; }
    .footer { padding:24px 32px; text-align:center; font-size:11px; color:#C9C5BC; }
    .trust { background:#F5ECD4; border:1px solid rgba(212,168,67,.3);
      border-radius:12px; padding:14px 18px; font-size:13px; color:#8B6914;
      margin:16px 0; }
    .warning { background:#FEF3C7; border:1px solid rgba(245,158,11,.3);
      border-radius:12px; padding:14px 18px; font-size:13px; color:#92400E;
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

export async function sendVerificationEmail(params: {
  to: string;
  displayName: string;
  verifyUrl: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Verify your email address</h1>
    <p>Hi ${esc(params.displayName)}, thanks for joining KiwiMart!</p>
    <p>Click the button below to verify your email and activate your account. This link expires in <strong>24 hours</strong>.</p>
    <a href="${esc(params.verifyUrl)}" class="btn">Verify my email →</a>
    <hr class="divider">
    <div class="trust">
      ✓ Check your spam folder if not received<br>
      ✓ You can still browse KiwiMart while waiting
    </div>
    <p style="font-size:12px; color:#C9C5BC; margin-top:16px;">
      If you didn't create a KiwiMart account, you can safely ignore this email.
    </p>`,
    `Verify your KiwiMart email address`
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: 'Verify your KiwiMart email address',
    html,
  });
}

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
  await sendTransactionalEmail({
    to: params.to,
    subject: `Welcome to KiwiMart, ${params.displayName}! 🥝`,
    html,
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
  await sendTransactionalEmail({
    to: params.to,
    subject: 'Reset your KiwiMart password',
    html,
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
  await sendTransactionalEmail({
    to: params.to,
    subject: `Offer received: ${formatted} for "${params.listingTitle}"`,
    html,
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
  await sendTransactionalEmail({ to: params.to, subject, html });
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
  await sendTransactionalEmail({
    to: params.to,
    subject: `Your order has been dispatched — ${params.listingTitle}`,
    html,
  });
}

// ── Delivery reminder emails (for auto-release cron) ─────────────────────────

export async function sendDeliveryReminderEmail(params: {
  to: string;
  buyerName: string;
  listingTitle: string;
  trackingNumber?: string;
  orderId: string;
  daysRemaining: number;
  confirmUrl: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Please confirm delivery 📦</h1>
    <p>Hi ${esc(params.buyerName)}, your order for <strong>${esc(params.listingTitle)}</strong> has been dispatched.</p>
    ${params.trackingNumber ? `<p>Tracking: <strong>${esc(params.trackingNumber)}</strong></p>` : ''}
    <p>Once you receive your item, please confirm delivery so the seller gets paid.</p>
    <div class="trust">
      You have <strong>${params.daysRemaining} days</strong> before payment is automatically released to the seller.
      If you have not received the item or it is not as described, open a dispute before then.
    </div>
    <a href="${esc(params.confirmUrl)}" class="btn">Confirm delivery →</a>
    <p style="font-size:12px; color:#9E9A91;">If there is an issue with your order, <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/buyer" style="color:#D4A843;">open a dispute</a> before the auto-release date.</p>`,
    `Reminder: please confirm delivery — ${params.listingTitle}`
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Reminder: Please confirm delivery — ${params.listingTitle}`,
    html,
  });
}

export async function sendOrderConfirmationEmail(params: {
  to: string;
  buyerName: string;
  sellerName: string;
  listingTitle: string;
  totalNzd: number;
  orderId: string;
  listingId: string;
}): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://kiwimart.vercel.app';
  const amount = `$${(params.totalNzd / 100).toFixed(2)} NZD`;
  const html = baseTemplate(
    `<h1>Your order is confirmed! 🎉</h1>
    <p>Hi ${esc(params.buyerName)}, your payment has been received and is held securely in escrow until you confirm delivery.</p>
    <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="color:#73706A;padding:6px 0;border-bottom:1px solid #F0EDE8">Item</td>
        <td style="color:#141414;font-weight:500;text-align:right;padding:6px 0;border-bottom:1px solid #F0EDE8">${esc(params.listingTitle)}</td>
      </tr>
      <tr>
        <td style="color:#73706A;padding:6px 0;border-bottom:1px solid #F0EDE8">Seller</td>
        <td style="color:#141414;text-align:right;padding:6px 0;border-bottom:1px solid #F0EDE8">${esc(params.sellerName)}</td>
      </tr>
      <tr>
        <td style="color:#73706A;padding:6px 0;border-bottom:1px solid #F0EDE8">Order ID</td>
        <td style="color:#141414;text-align:right;padding:6px 0;border-bottom:1px solid #F0EDE8;font-family:monospace;font-size:12px">${esc(params.orderId)}</td>
      </tr>
      <tr>
        <td style="color:#141414;font-weight:700;padding:8px 0 0">Total paid</td>
        <td style="color:#141414;font-weight:700;text-align:right;padding:8px 0 0;font-size:16px">${esc(amount)}</td>
      </tr>
    </table>
    <div class="trust">
      🛡️ Your ${esc(amount)} is held in escrow. The seller cannot access it until you confirm delivery.
    </div>
    <p><strong>What happens next:</strong><br>
    1. The seller will dispatch your item<br>
    2. You'll receive a shipping notification with tracking details<br>
    3. Once you receive the item, confirm delivery to release payment</p>
    <a href="${appUrl}/dashboard/buyer?tab=orders" class="btn">View your order →</a>`,
    `Order confirmed — ${params.listingTitle}`
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Order confirmed — ${params.listingTitle}`,
    html,
  });
}

export async function sendNewMessageEmail(params: {
  to: string;
  recipientName: string;
  senderName: string;
  messagePreview: string;
  listingTitle?: string;
  listingId?: string;
}): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://kiwimart.vercel.app';
  const preview = params.messagePreview.length > 120
    ? `${params.messagePreview.slice(0, 117)}...`
    : params.messagePreview;
  const html = baseTemplate(
    `<h1>💬 New message from ${esc(params.senderName)}</h1>
    <p>Hi ${esc(params.recipientName)},</p>
    ${params.listingTitle ? `<p style="font-size:12px;color:#9E9A91;margin-bottom:8px">Re: ${esc(params.listingTitle)}</p>` : ''}
    <div style="background:#F8F7F4;border-radius:12px;padding:16px;border-left:4px solid #D4A843;margin-bottom:16px">
      <p style="margin:0;font-size:14px;font-style:italic;color:#141414">"${esc(preview)}"</p>
      <p style="margin:8px 0 0;font-size:12px;color:#9E9A91">— ${esc(params.senderName)}</p>
    </div>
    <a href="${appUrl}/dashboard/buyer?tab=messages" class="btn">Reply to ${esc(params.senderName)} →</a>
    <p style="font-size:12px;color:#C9C5BC;text-align:center">You are receiving this because someone messaged you on KiwiMart.</p>`,
    `New message from ${params.senderName}`
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `New message from ${params.senderName}`,
    html,
  });
}

export async function sendDisputeOpenedEmail(params: {
  to: string;
  sellerName: string;
  buyerName: string;
  listingTitle: string;
  orderId: string;
  reason: string;
  description: string;
}): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://kiwimart.vercel.app';
  const formattedReason = params.reason
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
  const html = baseTemplate(
    `<div class="warning">
      ⚠️ <strong>A dispute has been opened by ${esc(params.buyerName)}</strong><br>
      Payment remains in escrow while this is under review.
    </div>
    <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="color:#73706A;padding:6px 0;border-bottom:1px solid #F0EDE8;width:30%">Item</td>
        <td style="color:#141414;font-weight:500;padding:6px 0;border-bottom:1px solid #F0EDE8">${esc(params.listingTitle)}</td>
      </tr>
      <tr>
        <td style="color:#73706A;padding:6px 0;border-bottom:1px solid #F0EDE8">Reason</td>
        <td style="color:#141414;padding:6px 0;border-bottom:1px solid #F0EDE8">${esc(formattedReason)}</td>
      </tr>
      <tr>
        <td style="color:#73706A;padding:6px 0;vertical-align:top">Description</td>
        <td style="color:#141414;padding:6px 0;line-height:1.6">${esc(params.description)}</td>
      </tr>
    </table>
    <p>Our team will review this dispute. <strong>Do not contact the buyer outside of KiwiMart.</strong></p>
    <a href="${appUrl}/dashboard/seller" class="btn">View dispute →</a>`,
    `⚠️ Dispute opened — ${params.listingTitle}`
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `⚠️ Dispute opened — ${params.listingTitle}`,
    html,
  });
}

export async function sendFinalDeliveryReminderEmail(params: {
  to: string;
  buyerName: string;
  listingTitle: string;
  trackingNumber?: string;
  orderId: string;
  daysRemaining: number;
  confirmUrl: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>⚠️ Action required — payment releases tomorrow</h1>
    <p>Hi ${esc(params.buyerName)}, this is an urgent reminder about your order:</p>
    <p><strong>${esc(params.listingTitle)}</strong></p>
    ${params.trackingNumber ? `<p>Tracking: <strong>${esc(params.trackingNumber)}</strong></p>` : ''}
    <div class="warning">
      <strong>Payment will be automatically released to the seller TOMORROW</strong> if you do not take action.
      If you have NOT received the item or it is NOT as described, please open a dispute immediately.
    </div>
    <a href="${esc(params.confirmUrl)}" class="btn">Confirm delivery →</a>
    <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/buyer" class="btn-secondary">Open a dispute</a>
    <p style="font-size:12px; color:#9E9A91;">Once payment is released it cannot be reversed. Act now if there is an issue.</p>`,
    `⚠️ Action required — payment releases tomorrow for ${params.listingTitle}`
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `⚠️ Action required — payment releases tomorrow for ${params.listingTitle}`,
    html,
  });
}
