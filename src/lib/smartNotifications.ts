// src/lib/smartNotifications.ts
// ─── Smart Notification Templates ──────────────────────────────────────────
// Wraps createNotification with warm, context-aware templates.
// All notifications use the existing notification DB + service pattern.

import { createNotification } from "@/modules/notifications/notification.service";

// ── Dispatch Reminders (for seller) ───────────────────────────────────────

export function notifySellerDispatchReminder(
  sellerId: string,
  orderId: string,
  buyerName: string,
  itemTitle: string,
  hoursSincePayment: number,
): void {
  let title: string;
  let body: string;

  if (hoursSincePayment <= 24) {
    title = `${buyerName} is waiting for "${itemTitle}"`;
    body = `${buyerName} ordered "${itemTitle}". Ready to dispatch? The sooner you ship, the happier your buyer!`;
  } else if (hoursSincePayment <= 48) {
    title = `Reminder: Please dispatch "${itemTitle}"`;
    body = `${buyerName} is waiting for "${itemTitle}". Orders should be shipped within 3 business days to maintain your seller rating.`;
  } else {
    title = `Urgent: "${itemTitle}" hasn't been dispatched`;
    body = `${buyerName} has been waiting ${Math.floor(hoursSincePayment / 24)} days for "${itemTitle}". Please ship today or the order may be at risk.`;
  }

  createNotification({
    userId: sellerId,
    type: "SYSTEM",
    title,
    body,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});
}

// ── Delivery Follow-ups (for buyer) ───────────────────────────────────────

export function notifyBuyerDeliveryDay(
  buyerId: string,
  orderId: string,
  itemTitle: string,
): void {
  createNotification({
    userId: buyerId,
    type: "ORDER_DISPATCHED",
    title: `"${itemTitle}" should arrive today!`,
    body: `Your item should be delivered today. We'll ask you to confirm once it's here.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});
}

export function notifyBuyerDeliveryOverdue(
  buyerId: string,
  orderId: string,
  itemTitle: string,
  daysPastEstimate: number,
): void {
  const isUrgent = daysPastEstimate >= 10;
  createNotification({
    userId: buyerId,
    type: "SYSTEM",
    title: isUrgent
      ? `It's been a while — has "${itemTitle}" arrived?`
      : `Has "${itemTitle}" arrived?`,
    body: isUrgent
      ? `Your item was expected ${daysPastEstimate} days ago. Please confirm delivery or let us know if you need help.`
      : `Your item was expected ${daysPastEstimate} days ago. If it has arrived, please confirm delivery.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});
}

// ── Celebration Notifications ─────────────────────────────────────────────

export function notifyOrderCompleted(
  buyerId: string,
  orderId: string,
  itemTitle: string,
  listingId: string,
): void {
  createNotification({
    userId: buyerId,
    type: "ORDER_COMPLETED",
    title: `Enjoy your "${itemTitle}"!`,
    body: `Your order is complete. We hope you love it! If you have a moment, leaving a review helps other buyers.`,
    orderId,
    listingId,
    link: `/orders/${orderId}`,
  }).catch(() => {});
}

export function notifySellerReviewReceived(
  sellerId: string,
  orderId: string,
  buyerName: string,
  rating: number,
  itemTitle: string,
): void {
  const stars =
    "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));
  createNotification({
    userId: sellerId,
    type: "SYSTEM",
    title: `New ${stars} review from ${buyerName}`,
    body: `${buyerName} left a ${rating.toFixed(1)}-star review on "${itemTitle}". Check it out!`,
    orderId,
    link: "/dashboard/seller?tab=reviews",
  }).catch(() => {});
}

export function notifySellerMilestone(
  sellerId: string,
  salesCount: number,
): void {
  createNotification({
    userId: sellerId,
    type: "SYSTEM",
    title: `You've completed ${salesCount} sales!`,
    body: `Congratulations on reaching ${salesCount} sales on KiwiMart! Keep up the great work.`,
    link: "/dashboard/seller",
  }).catch(() => {});
}

// ── Dispatch evidence reminders (for seller) ──────────────────────────────

export function notifySellerPhotoReminder(
  sellerId: string,
  orderId: string,
  itemTitle: string,
): void {
  createNotification({
    userId: sellerId,
    type: "SYSTEM",
    title: "Tip: Add dispatch photos",
    body: `Dispatch photos for "${itemTitle}" protect you in case of disputes. Sellers with photos have 3x fewer refunds.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});
}

// ── Delivery issue notifications ──────────────────────────────────────────

export function notifySellerDeliveryIssue(
  sellerId: string,
  orderId: string,
  buyerName: string,
  issueType: string,
  itemTitle: string,
): void {
  const issue = issueType.replace(/_/g, " ").toLowerCase();
  createNotification({
    userId: sellerId,
    type: "ORDER_DISPUTED",
    title: `${buyerName} reported a delivery issue`,
    body: `${buyerName} received "${itemTitle}" but reported: ${issue}. You have 72 hours to respond before it escalates.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});
}

export function notifyBuyerIssueAcknowledged(
  buyerId: string,
  orderId: string,
  sellerName: string,
  itemTitle: string,
): void {
  createNotification({
    userId: buyerId,
    type: "SYSTEM",
    title: `${sellerName} is looking into your issue`,
    body: `${sellerName} has been notified about the issue with "${itemTitle}". They have 72 hours to respond.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});
}
