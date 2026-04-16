// src/server/email/index.ts
// ─── Transactional Email ──────────────────────────────────────────────────────
// Transport layer: Resend (when RESEND_API_KEY is set) or console logging.
// All HTML templates are kept here; transport via Resend.

import { sendTransactionalEmail } from "./transport";
import { formatCentsAsNzd } from "@/lib/currency";
import { logger } from "@/shared/logger";
import { env } from "@/env";

// ── Email configuration from environment ─────────────────────────────────────
// All vars validated and defaulted by env.ts — no ?? fallbacks needed here.
const APP_NAME = env.NEXT_PUBLIC_APP_NAME;
const COMPANY_LEGAL_NAME_CFG = env.COMPANY_LEGAL_NAME;
const COMPANY_ADDRESS_CFG = env.COMPANY_ADDRESS;
const BUYER_PROTECTION_DISPLAY = env.NEXT_PUBLIC_BUYER_PROTECTION_DISPLAY;
const OFFER_EXPIRY_HOURS_CFG = env.OFFER_EXPIRY_HOURS;
const OFFER_PURCHASE_WINDOW_CFG = env.OFFER_PURCHASE_WINDOW_HOURS;
const REFUND_DAYS_MIN = env.REFUND_PROCESSING_DAYS_MIN;
const REFUND_DAYS_MAX = env.REFUND_PROCESSING_DAYS_MAX;
const PAYOUT_DAYS_MIN = env.PAYOUT_PROCESSING_DAYS_MIN;
const PAYOUT_DAYS_MAX = env.PAYOUT_PROCESSING_DAYS_MAX;
const RETURN_SHIP_DAYS = env.RETURN_SHIPPING_WINDOW_DAYS;
const LISTING_POLICY_PATH_CFG = env.LISTING_POLICY_PATH;
// NEXT_PUBLIC_APP_URL is validated as a required URL by env.ts — never empty.
const APP_URL = env.NEXT_PUBLIC_APP_URL;

// ── Helper: HTML-escape ───────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
        <div class="logo">🥝 ${APP_NAME}</div>
      </div>
      <div class="body">${content}</div>
    </div>
    <div class="footer">
      ${COMPANY_LEGAL_NAME_CFG} · ${COMPANY_ADDRESS_CFG}<br>
      <a href="${APP_URL}/unsubscribe" style="color:#C9C5BC;">Unsubscribe</a> ·
      <a href="${APP_URL}/privacy" style="color:#C9C5BC;">Privacy Policy</a>
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
    <p>Hi ${esc(params.displayName)}, thanks for joining ${APP_NAME}!</p>
    <p>Click the button below to verify your email and activate your account. This link expires in <strong>24 hours</strong>.</p>
    <a href="${esc(params.verifyUrl)}" class="btn">Verify my email →</a>
    <hr class="divider">
    <div class="trust">
      ✓ Check your spam folder if not received<br>
      ✓ You can still browse ${APP_NAME} while waiting
    </div>
    <p style="font-size:12px; color:#C9C5BC; margin-top:16px;">
      If you didn't create a ${APP_NAME} account, you can safely ignore this email.
    </p>`,
    `Verify your ${APP_NAME} email address`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Verify your ${APP_NAME} email address`,
    html,
  });
}

export async function sendWelcomeEmail(params: {
  to: string;
  displayName: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Welcome to ${APP_NAME}, ${esc(params.displayName)}! 🥝</h1>
    <p>You're now part of Aotearoa's most trusted marketplace. Millions of Kiwis buy and sell here — and now so can you.</p>
    <p>Here's what you can do right now:</p>
    <p><strong>🔍 Browse listings</strong> — find great deals from NZ sellers near you.</p>
    <p><strong>📦 List an item</strong> — sell in under 2 minutes, $0 listing fee.</p>
    <p><strong>🛡 ${BUYER_PROTECTION_DISPLAY} protection</strong> — every purchase backed by ${APP_NAME}'s buyer protection.</p>
    <a href="${APP_URL}" class="btn">Start exploring →</a>
    <div class="trust">Your account is protected by secure escrow payments and ID-verified sellers.</div>`,
    `Welcome to ${APP_NAME}, ${params.displayName}!`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Welcome to ${APP_NAME}, ${params.displayName}! 🥝`,
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
    <p>Hi ${esc(params.displayName)}, we received a request to reset your ${APP_NAME} password.</p>
    <p>Click the button below to set a new password. This link expires in <strong>${params.expiresInMinutes} minutes</strong>.</p>
    <a href="${esc(params.resetUrl)}" class="btn">Reset my password →</a>
    <hr class="divider">
    <p style="font-size:12px;">If you didn't request this, ignore this email — your password won't change. If you're worried about your account, <a href="${APP_URL}/support" style="color:#D4A843;">contact support</a>.</p>
    <p style="font-size:11px; color:#C9C5BC;">For security, this link can only be used once and expires after ${params.expiresInMinutes} minutes.</p>`,
    `Reset your ${APP_NAME} password`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Reset your ${APP_NAME} password`,
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
  const formatted = `$${params.offerAmount.toLocaleString("en-NZ")}`;
  const html = baseTemplate(
    `<h1>You've received an offer! 🎉</h1>
    <p>Hi ${esc(params.sellerName)}, <strong>${esc(params.buyerName)}</strong> has made an offer of <strong>${esc(formatted)}</strong> on your listing:</p>
    <p><strong>${esc(params.listingTitle)}</strong></p>
    <a href="${esc(params.listingUrl)}" class="btn">View offer →</a>
    <p style="font-size:12px; color:#9E9A91;">Offers expire after ${OFFER_EXPIRY_HOURS_CFG} hours. Sign in to accept or decline.</p>`,
    `You received a ${formatted} offer`,
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
        <p>Complete your purchase within <strong>${OFFER_PURCHASE_WINDOW_CFG} hours</strong> to secure the item.</p>
        <a href="${esc(params.listingUrl)}" class="btn">Complete purchase →</a>
        <div class="trust">Your payment is protected by ${APP_NAME}'s ${BUYER_PROTECTION_DISPLAY} Buyer Protection. Funds are held in escrow until you confirm delivery.</div>`
      : `<h1>Offer update</h1>
        <p>Hi ${esc(params.buyerName)}, the seller has declined your offer on <strong>${esc(params.listingTitle)}</strong>.</p>
        <p>You can make a new offer or browse similar listings.</p>
        <a href="${esc(params.listingUrl)}" class="btn">View listing →</a>`,
    subject,
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
    ${
      params.trackingNumber
        ? `<p>Tracking number: <strong>${esc(params.trackingNumber)}</strong>${params.trackingUrl ? ` — <a href="${esc(params.trackingUrl)}" style="color:#D4A843;">track your parcel</a>` : ""}</p>`
        : ""
    }
    <p>Once you receive and inspect your item, please confirm delivery in ${APP_NAME} so the seller gets paid.</p>
    <a href="${esc(params.orderUrl)}" class="btn">View order →</a>
    <div class="trust">Your payment is held securely until you confirm receipt. Don't confirm delivery until you're happy with the item.</div>`,
    "Your order has been dispatched",
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
    ${params.trackingNumber ? `<p>Tracking: <strong>${esc(params.trackingNumber)}</strong></p>` : ""}
    <p>Once you receive your item, please confirm delivery so the seller gets paid.</p>
    <div class="trust">
      You have <strong>${params.daysRemaining} days</strong> before payment is automatically released to the seller.
      If you have not received the item or it is not as described, open a dispute before then.
    </div>
    <a href="${esc(params.confirmUrl)}" class="btn">Confirm delivery →</a>
    <p style="font-size:12px; color:#9E9A91;">If there is an issue with your order, <a href="${APP_URL}/dashboard/buyer" style="color:#D4A843;">open a dispute</a> before the auto-release date.</p>`,
    `Reminder: please confirm delivery — ${params.listingTitle}`,
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
  const amount = formatCentsAsNzd(params.totalNzd);
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
    <a href="${APP_URL}/dashboard/buyer?tab=orders" class="btn">View your order →</a>`,
    `Order confirmed — ${params.listingTitle}`,
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
  const preview =
    params.messagePreview.length > 120
      ? `${params.messagePreview.slice(0, 117)}...`
      : params.messagePreview;
  const html = baseTemplate(
    `<h1>💬 New message from ${esc(params.senderName)}</h1>
    <p>Hi ${esc(params.recipientName)},</p>
    ${params.listingTitle ? `<p style="font-size:12px;color:#9E9A91;margin-bottom:8px">Re: ${esc(params.listingTitle)}</p>` : ""}
    <div style="background:#F8F7F4;border-radius:12px;padding:16px;border-left:4px solid #D4A843;margin-bottom:16px">
      <p style="margin:0;font-size:14px;font-style:italic;color:#141414">"${esc(preview)}"</p>
      <p style="margin:8px 0 0;font-size:12px;color:#9E9A91">— ${esc(params.senderName)}</p>
    </div>
    <a href="${APP_URL}/dashboard/buyer?tab=messages" class="btn">Reply to ${esc(params.senderName)} →</a>
    <p style="font-size:12px;color:#C9C5BC;text-align:center">You are receiving this because someone messaged you on ${APP_NAME}.</p>`,
    `New message from ${params.senderName}`,
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
  const formattedReason = params.reason
    .replace(/_/g, " ")
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
    <p>Our team will review this dispute. <strong>Do not contact the buyer outside of ${APP_NAME}.</strong></p>
    <a href="${APP_URL}/dashboard/seller" class="btn">View dispute →</a>`,
    `⚠️ Dispute opened — ${params.listingTitle}`,
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
    ${params.trackingNumber ? `<p>Tracking: <strong>${esc(params.trackingNumber)}</strong></p>` : ""}
    <div class="warning">
      <strong>Payment will be automatically released to the seller TOMORROW</strong> if you do not take action.
      If you have NOT received the item or it is NOT as described, please open a dispute immediately.
    </div>
    <a href="${esc(params.confirmUrl)}" class="btn">Confirm delivery →</a>
    <a href="${APP_URL}/dashboard/buyer" class="btn-secondary">Open a dispute</a>
    <p style="font-size:12px; color:#9E9A91;">Once payment is released it cannot be reversed. Act now if there is an issue.</p>`,
    `⚠️ Action required — payment releases tomorrow for ${params.listingTitle}`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `⚠️ Action required — payment releases tomorrow for ${params.listingTitle}`,
    html,
  });
}

// ── Listing moderation emails ────────────────────────────────────────────────

export async function sendListingApprovedEmail(params: {
  to: string;
  sellerName: string;
  listingTitle: string;
  listingUrl: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Your listing is live!</h1>
    <p>Hi ${esc(params.sellerName)}, great news — your listing has been approved and is now visible to buyers.</p>
    <p style="font-size:18px; font-weight:700; margin:16px 0;">${esc(params.listingTitle)}</p>
    <a href="${esc(params.listingUrl)}" class="btn">View your listing</a>
    <div class="trust">Your listing is now live on ${APP_NAME}. Buyers can find it in search results and browse pages.</div>`,
    `Your listing "${params.listingTitle}" is now live`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Your listing is live — "${params.listingTitle}"`,
    html,
  });
}

export async function sendListingNeedsChangesEmail(params: {
  to: string;
  sellerName: string;
  listingTitle: string;
  moderationNote: string;
  editUrl: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Your listing needs changes</h1>
    <p>Hi ${esc(params.sellerName)}, our team reviewed your listing and it needs a few changes before it can go live.</p>
    <p style="font-size:18px; font-weight:700; margin:16px 0;">${esc(params.listingTitle)}</p>
    <div class="warning">
      <strong>Reviewer note:</strong><br>
      ${esc(params.moderationNote)}
    </div>
    <p>Please update your listing and resubmit for review.</p>
    <a href="${esc(params.editUrl)}" class="btn">Edit your listing</a>
    <p style="font-size:12px; color:#9E9A91;">If you have questions about this review, please contact our support team.</p>`,
    `Your listing "${params.listingTitle}" needs changes`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Action needed — "${params.listingTitle}" requires changes`,
    html,
  });
}

export async function sendListingRejectedEmail(params: {
  to: string;
  sellerName: string;
  listingTitle: string;
  rejectionReason: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Listing not approved</h1>
    <p>Hi ${esc(params.sellerName)}, unfortunately your listing could not be approved.</p>
    <p style="font-size:18px; font-weight:700; margin:16px 0;">${esc(params.listingTitle)}</p>
    <div class="warning">
      <strong>Reason:</strong><br>
      ${esc(params.rejectionReason)}
    </div>
    <p>Please review our <a href="${APP_URL}${LISTING_POLICY_PATH_CFG}" style="color:#D4A843;">listing guidelines</a> and try again with a new listing that complies with our policies.</p>
    <p style="font-size:12px; color:#9E9A91;">If you believe this was a mistake, please contact our support team.</p>`,
    `Your listing "${params.listingTitle}" was not approved`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Listing not approved — "${params.listingTitle}"`,
    html,
  });
}

// ── Payout & order lifecycle emails ─────────────────────────────────────────

export async function sendPayoutInitiatedEmail(params: {
  to: string;
  sellerName: string;
  amountNzd: number; // in cents
  listingTitle: string;
  orderId: string;
  estimatedArrival: string;
}): Promise<void> {
  const amount = formatCentsAsNzd(params.amountNzd);
  const html = baseTemplate(
    `<h1>Your payout is on its way 💰</h1>
    <p>Hi ${esc(params.sellerName)},</p>
    <p>Great news — your payout of <strong>${esc(amount)}</strong> for the sale of <strong>"${esc(params.listingTitle)}"</strong> has been initiated and is on its way to your bank account.</p>
    <div class="trust">
      ✓ Estimated arrival: <strong>${esc(params.estimatedArrival)}</strong><br>
      ✓ Your payout is being processed via Stripe Connect
    </div>
    <p>If you have any questions about your payout, you can view the order details in your dashboard.</p>
    <a href="${APP_URL}/orders/${esc(params.orderId)}" class="btn">View Order →</a>`,
    `Your payout of ${amount} is on its way`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Your ${APP_NAME} payout is on its way`,
    html,
  });
}

// ── Order complete emails ─────────────────────────────────────────────────────

export async function sendOrderCompleteBuyerEmail(params: {
  to: string;
  buyerName: string;
  sellerName: string;
  listingTitle: string;
  orderId: string;
  totalNzd: number; // in cents
  orderUrl: string;
}): Promise<void> {
  const amount = formatCentsAsNzd(params.totalNzd);
  const html = baseTemplate(
    `<h1>Your order is complete 🎉</h1>
    <p>Hi ${esc(params.buyerName)},</p>
    <p>You've confirmed delivery of <strong>"${esc(params.listingTitle)}"</strong> — thanks for buying on ${APP_NAME}!</p>
    <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="color:#73706A;padding:6px 0;border-bottom:1px solid #F0EDE8">Order reference</td>
        <td style="color:#141414;font-weight:500;text-align:right;padding:6px 0;border-bottom:1px solid #F0EDE8">${esc(params.orderId)}</td>
      </tr>
      <tr>
        <td style="color:#73706A;padding:6px 0;border-bottom:1px solid #F0EDE8">Item</td>
        <td style="color:#141414;font-weight:500;text-align:right;padding:6px 0;border-bottom:1px solid #F0EDE8">${esc(params.listingTitle)}</td>
      </tr>
      <tr>
        <td style="color:#73706A;padding:6px 0;border-bottom:1px solid #F0EDE8">Seller</td>
        <td style="color:#141414;font-weight:500;text-align:right;padding:6px 0;border-bottom:1px solid #F0EDE8">${esc(params.sellerName)}</td>
      </tr>
      <tr>
        <td style="color:#73706A;padding:6px 0">Total paid</td>
        <td style="color:#141414;font-weight:600;text-align:right;padding:6px 0">${esc(amount)}</td>
      </tr>
    </table>
    <div class="trust">
      ✓ Payment has been released to the seller<br>
      ✓ Your purchase is now complete
    </div>
    <p>Happy with your purchase? Leave a review to help other buyers and reward great sellers.</p>
    <a href="${esc(params.orderUrl)}" class="btn">View order &amp; leave a review →</a>
    <p style="font-size:12px;color:#9E9A91;">If you have any concerns about this transaction, please <a href="${APP_URL}/help" style="color:#D4A843;">contact support</a>.</p>`,
    `Your order is complete — ${params.listingTitle}`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Your order is complete — ${params.listingTitle}`,
    html,
  });
}

export async function sendOrderCompleteSellerEmail(params: {
  to: string;
  sellerName: string;
  buyerFirstName: string;
  listingTitle: string;
  orderId: string;
  totalNzd: number; // in cents
  payoutTimelineDays: number;
  dashboardUrl: string;
}): Promise<void> {
  const amount = formatCentsAsNzd(params.totalNzd);
  const html = baseTemplate(
    `<h1>Order complete — payment released 💰</h1>
    <p>Hi ${esc(params.sellerName)},</p>
    <p>${esc(params.buyerFirstName)} confirmed delivery of <strong>"${esc(params.listingTitle)}"</strong>. Your payment has been released from escrow.</p>
    <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="color:#73706A;padding:6px 0;border-bottom:1px solid #F0EDE8">Order reference</td>
        <td style="color:#141414;font-weight:500;text-align:right;padding:6px 0;border-bottom:1px solid #F0EDE8">${esc(params.orderId)}</td>
      </tr>
      <tr>
        <td style="color:#73706A;padding:6px 0;border-bottom:1px solid #F0EDE8">Item sold</td>
        <td style="color:#141414;font-weight:500;text-align:right;padding:6px 0;border-bottom:1px solid #F0EDE8">${esc(params.listingTitle)}</td>
      </tr>
      <tr>
        <td style="color:#73706A;padding:6px 0">Amount</td>
        <td style="color:#141414;font-weight:600;text-align:right;padding:6px 0">${esc(amount)}</td>
      </tr>
    </table>
    <div class="trust">
      ✓ Payment released from escrow<br>
      ✓ Payout arriving in approximately <strong>${params.payoutTimelineDays} business days</strong>
    </div>
    <a href="${esc(params.dashboardUrl)}" class="btn">View seller dashboard →</a>`,
    `Order complete — payment released for "${params.listingTitle}"`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Order complete — payment released`,
    html,
  });
}

export async function sendCancellationEmail(params: {
  to: string;
  recipientName: string;
  recipientRole: "buyer" | "seller";
  orderId: string;
  listingTitle: string;
  cancellationReason: string;
  refundAmount: number | null; // in cents; null = no refund applies
}): Promise<void> {
  const isBuyer = params.recipientRole === "buyer";
  const subject = isBuyer
    ? `Your order has been cancelled — ${params.listingTitle}`
    : `An order has been cancelled — ${params.listingTitle}`;

  const reasonHtml = params.cancellationReason
    ? `<p><strong>Reason:</strong> ${esc(params.cancellationReason)}</p>`
    : "";

  let bodyContent: string;
  if (isBuyer) {
    const refundHtml =
      params.refundAmount != null && params.refundAmount > 0
        ? `<div class="trust">Your refund of <strong>${formatCentsAsNzd(params.refundAmount)}</strong> will be returned to your original payment method within ${REFUND_DAYS_MIN}–${REFUND_DAYS_MAX} business days.</div>`
        : "";
    bodyContent = `<h1>Your order has been cancelled</h1>
    <p>Hi ${esc(params.recipientName)},</p>
    <p>Your order for <strong>"${esc(params.listingTitle)}"</strong> has been cancelled.</p>
    ${reasonHtml}
    ${refundHtml}
    <a href="${APP_URL}/orders/${esc(params.orderId)}" class="btn">View Order →</a>`;
  } else {
    bodyContent = `<h1>An order has been cancelled</h1>
    <p>Hi ${esc(params.recipientName)},</p>
    <p>The order for <strong>"${esc(params.listingTitle)}"</strong> has been cancelled.</p>
    ${reasonHtml}
    <p>The item is now available to relist if you wish.</p>
    <a href="${APP_URL}/orders/${esc(params.orderId)}" class="btn">View Order →</a>`;
  }

  const html = baseTemplate(bodyContent, subject);
  await sendTransactionalEmail({ to: params.to, subject, html });
}

export async function sendDisputeResolvedEmail(params: {
  to: string;
  recipientName: string;
  recipientRole: "buyer" | "seller";
  orderId: string;
  listingTitle: string;
  resolution: "BUYER_WON" | "SELLER_WON" | "PARTIAL_REFUND";
  refundAmount: number | null; // in cents; used for BUYER_WON and PARTIAL_REFUND
  adminNote: string | null;
}): Promise<void> {
  const isBuyer = params.recipientRole === "buyer";
  const refundFmt =
    params.refundAmount != null ? formatCentsAsNzd(params.refundAmount) : "";

  // Subject varies by role + resolution outcome
  let subject: string;
  if (isBuyer) {
    if (params.resolution === "BUYER_WON") {
      subject = `Dispute resolved in your favour — ${params.listingTitle}`;
    } else if (params.resolution === "SELLER_WON") {
      subject = `Dispute outcome — ${params.listingTitle}`;
    } else {
      subject = `Dispute resolved — partial refund issued for ${params.listingTitle}`;
    }
  } else {
    if (params.resolution === "SELLER_WON") {
      subject = `Dispute resolved in your favour — ${params.listingTitle}`;
    } else if (params.resolution === "BUYER_WON") {
      subject = `Dispute outcome — ${params.listingTitle}`;
    } else {
      subject = `Dispute resolved — partial refund issued for ${params.listingTitle}`;
    }
  }

  // Main message body varies by role + resolution
  let mainMessage: string;
  if (isBuyer) {
    if (params.resolution === "BUYER_WON") {
      mainMessage = `<p>We have reviewed your dispute for <strong>"${esc(params.listingTitle)}"</strong> and decided in your favour.</p>
      <div class="trust">Your refund of <strong>${esc(refundFmt)}</strong> will be returned to your original payment method within ${REFUND_DAYS_MIN}–${REFUND_DAYS_MAX} business days.</div>`;
    } else if (params.resolution === "SELLER_WON") {
      mainMessage = `<p>We have reviewed your dispute for <strong>"${esc(params.listingTitle)}"</strong>. After reviewing all evidence, we were unable to rule in your favour on this occasion.</p>
      <p>If you believe this decision is incorrect, please <a href="${APP_URL}/support" style="color:#D4A843;">contact our support team</a>.</p>`;
    } else {
      mainMessage = `<p>We have reviewed your dispute for <strong>"${esc(params.listingTitle)}"</strong> and issued a partial refund of <strong>${esc(refundFmt)}</strong>.</p>
      <div class="trust">This will be returned to your original payment method within ${REFUND_DAYS_MIN}–${REFUND_DAYS_MAX} business days.</div>`;
    }
  } else {
    if (params.resolution === "BUYER_WON") {
      mainMessage = `<p>We have reviewed the dispute for <strong>"${esc(params.listingTitle)}"</strong> and ruled in the buyer's favour.</p>
      <p>Your payout for this order will not be released. If you believe this decision is incorrect, please <a href="${APP_URL}/support" style="color:#D4A843;">contact our support team</a>.</p>`;
    } else if (params.resolution === "SELLER_WON") {
      mainMessage = `<p>We have reviewed the dispute for <strong>"${esc(params.listingTitle)}"</strong> and decided in your favour.</p>
      <div class="trust">Your payout will be released within ${PAYOUT_DAYS_MIN}–${PAYOUT_DAYS_MAX} business days.</div>`;
    } else {
      mainMessage = `<p>We have reviewed the dispute for <strong>"${esc(params.listingTitle)}"</strong>. A partial refund of <strong>${esc(refundFmt)}</strong> has been issued to the buyer.</p>
      <div class="trust">The remaining balance will be released to you within ${PAYOUT_DAYS_MIN}–${PAYOUT_DAYS_MAX} business days.</div>`;
    }
  }

  const adminNoteHtml = params.adminNote
    ? `<div class="warning"><strong>Note from our team:</strong><br>${esc(params.adminNote)}</div>`
    : "";

  const html = baseTemplate(
    `<h1>Dispute resolved</h1>
    <p>Hi ${esc(params.recipientName)},</p>
    ${mainMessage}
    ${adminNoteHtml}
    <a href="${APP_URL}/orders/${esc(params.orderId)}" class="btn">View Order →</a>`,
    subject,
  );
  await sendTransactionalEmail({ to: params.to, subject, html });
}

export async function sendReturnRequestEmail(params: {
  to: string;
  recipientName: string;
  recipientRole: "buyer" | "seller";
  orderId: string;
  listingTitle: string;
  action: "REQUESTED" | "APPROVED" | "REJECTED";
  reason: string | null;
  sellerNote: string | null;
}): Promise<void> {
  let subject: string;
  if (params.action === "REQUESTED") {
    subject = `Return requested for your order — ${params.listingTitle}`;
  } else if (params.action === "APPROVED") {
    subject = `Your return request has been approved — ${params.listingTitle}`;
  } else {
    subject = `Your return request — ${params.listingTitle}`;
  }

  let bodyContent: string;
  if (params.action === "REQUESTED") {
    bodyContent = `<h1>Return requested for your order</h1>
    <p>Hi ${esc(params.recipientName)},</p>
    <p>A buyer has requested a return for <strong>"${esc(params.listingTitle)}"</strong>.</p>
    ${params.reason ? `<p><strong>Their reason:</strong> ${esc(params.reason)}</p>` : ""}
    <p>Please respond to this request from your order dashboard within 3 days.</p>
    <a href="${APP_URL}/orders/${esc(params.orderId)}" class="btn">View Return Request →</a>`;
  } else if (params.action === "APPROVED") {
    bodyContent = `<h1>Your return request has been approved 🎉</h1>
    <p>Hi ${esc(params.recipientName)},</p>
    <p>Good news — your return request for <strong>"${esc(params.listingTitle)}"</strong> has been approved.</p>
    ${params.sellerNote ? `<div class="trust"><strong>Message from seller:</strong><br>${esc(params.sellerNote)}</div>` : ""}
    <p>Please ship the item back within ${RETURN_SHIP_DAYS} days. Once the seller confirms receipt, your refund will be processed.</p>
    <a href="${APP_URL}/orders/${esc(params.orderId)}" class="btn">View Order →</a>`;
  } else {
    bodyContent = `<h1>Your return request</h1>
    <p>Hi ${esc(params.recipientName)},</p>
    <p>Your return request for <strong>"${esc(params.listingTitle)}"</strong> has been reviewed.</p>
    ${params.sellerNote ? `<div class="warning"><strong>Message from seller:</strong><br>${esc(params.sellerNote)}</div>` : ""}
    <p>If you believe this decision is unfair, you can <a href="${APP_URL}/orders/${esc(params.orderId)}" style="color:#D4A843;">open a dispute</a> from your order page.</p>
    <a href="${APP_URL}/orders/${esc(params.orderId)}" class="btn">View Order →</a>`;
  }

  const html = baseTemplate(bodyContent, subject);
  await sendTransactionalEmail({ to: params.to, subject, html });
}

export async function sendPriceDropEmail(params: {
  to: string;
  buyerName: string;
  listingTitle: string;
  oldPrice: string;
  newPrice: string;
  savings: string;
  dropPercent: number;
  listingUrl: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Price dropped on a listing you're watching! 📉</h1>
    <p>Hi ${esc(params.buyerName)}, great news — a listing on your watchlist just got cheaper:</p>
    <p style="font-size:18px; font-weight:700; margin:16px 0;">${esc(params.listingTitle)}</p>
    <table style="width:100%; border-collapse:collapse; margin:16px 0;">
      <tr>
        <td style="padding:8px 0; font-size:14px; color:#9E9A91;">Was</td>
        <td style="padding:8px 0; font-size:14px; text-decoration:line-through; color:#9E9A91; text-align:right;">NZ${esc(params.oldPrice)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0; font-size:18px; font-weight:700; color:#141414;">Now</td>
        <td style="padding:8px 0; font-size:18px; font-weight:700; color:#141414; text-align:right;">NZ${esc(params.newPrice)}</td>
      </tr>
    </table>
    <div class="trust">
      You save <strong>NZ${esc(params.savings)}</strong> (${params.dropPercent}% off) — grab it before someone else does!
    </div>
    <a href="${esc(params.listingUrl)}" class="btn">View listing →</a>
    <hr class="divider">
    <p style="font-size:11px; color:#C9C5BC;">
      You're receiving this because you have price drop alerts enabled for this listing.
      <a href="${APP_URL}/dashboard/buyer?tab=watchlist" style="color:#C9C5BC;">Manage alerts</a>
    </p>`,
    `Price dropped ${params.dropPercent}% on ${params.listingTitle}`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `📉 Price dropped ${params.dropPercent}% on "${params.listingTitle}"`,
    html,
  });
}

// ── Data Export Email (NZ Privacy Act 2020) ──────────────────────────────────

export async function sendDataExportEmail(params: {
  to: string;
  displayName: string;
  /** Presigned R2 download URL — valid for 24 hours. */
  downloadUrl: string;
  /** Human-readable expiry, e.g. "15 Jan 2026, 3:45 pm". */
  expiresAt: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Your ${esc(APP_NAME)} data export is ready</h1>
    <p>Kia ora ${esc(params.displayName)},</p>
    <p>
      Your personal data export has been prepared as requested under the
      <strong>NZ Privacy Act 2020</strong> (Information Privacy Principle 6).
    </p>
    <p>
      Click the button below to download your data. This link will expire in
      <strong>24 hours</strong> (at ${esc(params.expiresAt)}).
    </p>
    <div style="text-align:center; margin:32px 0;">
      <a href="${params.downloadUrl}"
         style="background:#D4A843; color:#141414; padding:14px 28px; border-radius:8px; font-weight:700; font-size:15px; text-decoration:none; display:inline-block;">
        Download Your Data
      </a>
    </div>
    <p style="font-size:13px; color:#9E9A91;">
      If the button does not work, copy and paste this link into your browser:
    </p>
    <p style="font-size:12px; word-break:break-all; color:#9E9A91;">${esc(params.downloadUrl)}</p>
    <hr class="divider">
    <p style="font-size:12px; color:#9E9A91;">
      This link is time-limited and will expire after 24 hours. The file will be
      permanently deleted from our servers after this time. If you need another
      copy, you can request a new export from
      <a href="${APP_URL}/account/settings" style="color:#D4A843;">Account Settings</a>.
      For questions, contact us at
      <a href="mailto:privacy@buyzi.co.nz" style="color:#D4A843;">privacy@buyzi.co.nz</a>.
    </p>`,
    `Your ${APP_NAME} data export is ready`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Your ${APP_NAME} data export is ready`,
    html,
  });
}

// ── Account Erasure Confirmation (NZ Privacy Act 2020) ───────────────────────

export async function sendErasureConfirmationEmail(params: {
  to: string;
  displayName: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Your account has been deleted</h1>
    <p>Kia ora ${esc(params.displayName)},</p>
    <p>
      Your ${esc(APP_NAME)} account has been permanently deleted as requested.
      All personal data has been removed in accordance with the
      <strong>NZ Privacy Act 2020</strong>.
    </p>
    <p>
      The following data has been deleted or anonymised:
    </p>
    <ul style="font-size:14px; line-height:1.7; color:#73706A; margin:0 0 16px; padding-left:20px;">
      <li>Profile information (name, email, bio, phone)</li>
      <li>Messages and watchlist items</li>
      <li>Payment and payout details</li>
      <li>Login sessions and security credentials</li>
    </ul>
    <p>
      Order history is retained for financial record-keeping as required by NZ law.
      If you have questions, contact us at
      <a href="mailto:privacy@buyzi.co.nz" style="color:#D4A843;">privacy@buyzi.co.nz</a>.
    </p>
    <hr class="divider">
    <p style="font-size:12px; color:#9E9A91;">
      This confirmation was sent to your registered email address before deletion.
      You will not receive further emails from ${esc(APP_NAME)}.
    </p>`,
    `Your ${APP_NAME} account has been deleted`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Your ${APP_NAME} account has been deleted`,
    html,
  });
}

// ── Account Erasure Request (NZ Privacy Act 2020) ────────────────────────────

export async function sendErasureRequestEmail(params: {
  to: string;
  displayName: string;
  confirmUrl: string;
}): Promise<void> {
  const html = baseTemplate(
    `<h1>Confirm account deletion</h1>
    <p>Kia ora ${esc(params.displayName)},</p>
    <p>
      We received a request to permanently delete your ${esc(APP_NAME)} account
      and all associated personal data in accordance with the
      <strong>NZ Privacy Act 2020</strong>.
    </p>
    <div class="warning">
      <strong>⚠ This action is permanent and cannot be undone.</strong>
      All your profile information, messages, and saved items will be deleted.
    </div>
    <p>If you made this request, click the button below to confirm:</p>
    <a href="${esc(params.confirmUrl)}" class="btn">Confirm account deletion →</a>
    <p style="font-size:12px; color:#9E9A91;">
      This link expires in 24 hours. If you did not request account deletion,
      you can safely ignore this email — your account will remain active.
    </p>
    <hr class="divider">
    <p style="font-size:12px; color:#9E9A91;">
      For privacy enquiries contact
      <a href="mailto:privacy@buyzi.co.nz" style="color:#D4A843;">privacy@buyzi.co.nz</a>.
    </p>`,
    `Confirm deletion of your ${APP_NAME} account`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `Confirm deletion of your ${APP_NAME} account`,
    html,
  });
}

// ── Admin: ID Verification Notification ──────────────────────────────────────

export async function sendAdminIdVerificationEmail(params: {
  to: string;
  userId: string;
  userEmail: string;
  submittedAt: string;
  adminUrl: string;
}): Promise<void> {
  const appName = env.NEXT_PUBLIC_APP_NAME;
  const html = baseTemplate(
    `<h1>New ID Verification Request</h1>
    <p>A seller has submitted their ID for verification.</p>
    <table style="width:100%; border-collapse:collapse; font-size:14px; margin:16px 0;">
      <tr>
        <td style="padding:8px 0; color:#9E9A91; width:140px;">User ID</td>
        <td style="padding:8px 0; font-weight:600;">${esc(params.userId)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0; color:#9E9A91;">Email</td>
        <td style="padding:8px 0; font-weight:600;">${esc(params.userEmail)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0; color:#9E9A91;">Submitted at</td>
        <td style="padding:8px 0;">${esc(params.submittedAt)}</td>
      </tr>
    </table>
    <a href="${esc(params.adminUrl)}" class="btn">Review in Admin Dashboard →</a>`,
    `[${appName}] New ID Verification Request`,
  );
  await sendTransactionalEmail({
    to: params.to,
    subject: `[${appName}] New ID Verification Request`,
    html,
  });
}
