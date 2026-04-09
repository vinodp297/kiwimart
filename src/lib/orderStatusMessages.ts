// src/lib/orderStatusMessages.ts
// ─── Plain-English Order Status Messages ───────────────────────────────────
// Takes an order + viewer role and returns rich, human-readable status info.
// Used by the order detail page, buyer dashboard, and seller dashboard.

import { formatPrice } from "@/lib/utils";
import { MS_PER_HOUR, MS_PER_DAY } from "@/lib/time";

// ── Types ─────────────────────────────────────────────────────────────────

export interface OrderStatusInfo {
  statusLabel: string;
  statusDescription: string;
  progressStep: number;
  progressTotal: number;
  nextAction: string | null;
  timeRemaining: string | null;
  whatHappensNext: string;
  celebrationMessage: string | null;
  actionButton: { label: string; action: string } | null;
}

export interface OrderForStatus {
  status: string;
  total: number; // NZD dollars
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  disputeOpenedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  trackingNumber: string | null;
  sellerRespondedAt: string | null;
  listingTitle: string;
  otherPartyName: string;
  isBuyer: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatTimeRemaining(targetDate: Date): string | null {
  const ms = targetDate.getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / MS_PER_HOUR);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) {
    return remainingHours > 0
      ? `${days} day${days !== 1 ? "s" : ""}, ${remainingHours} hour${remainingHours !== 1 ? "s" : ""}`
      : `${days} day${days !== 1 ? "s" : ""}`;
  }
  if (hours > 0) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  const mins = Math.max(1, Math.floor(ms / (1000 * 60)));
  return `${mins} minute${mins !== 1 ? "s" : ""}`;
}

function _daysBetween(a: string | Date, b: Date = new Date()): number {
  const dateA = typeof a === "string" ? new Date(a) : a;
  return Math.floor((b.getTime() - dateA.getTime()) / MS_PER_DAY);
}

// ── Main Function ─────────────────────────────────────────────────────────

export function getOrderStatusInfo(
  order: OrderForStatus,
  estimatedDeliveryDate?: string | null,
  courier?: string | null,
): OrderStatusInfo {
  const { isBuyer } = order;
  const _seller = isBuyer ? order.otherPartyName : "you";
  const _buyer = isBuyer ? "you" : order.otherPartyName;
  const item = order.listingTitle;
  const price = formatPrice(order.total);

  switch (order.status) {
    // ── AWAITING_PAYMENT ──────────────────────────────────────────
    case "awaiting_payment":
      return {
        statusLabel: "Completing payment",
        statusDescription:
          "Your payment is being processed. This usually takes a few seconds.",
        progressStep: 1,
        progressTotal: 5,
        nextAction: null,
        timeRemaining: null,
        whatHappensNext:
          "Once payment is confirmed, the seller will be notified to prepare your order.",
        celebrationMessage: null,
        actionButton: null,
      };

    // ── PAYMENT_HELD ──────────────────────────────────────────────
    case "payment_held":
      if (isBuyer) {
        return {
          statusLabel: "Order confirmed",
          statusDescription: `Your payment of ${price} is held securely. ${order.otherPartyName} is preparing your order.`,
          progressStep: 2,
          progressTotal: 5,
          nextAction: `${order.otherPartyName} needs to dispatch your item`,
          timeRemaining: null,
          whatHappensNext:
            "The seller usually dispatches within 1-2 business days. You'll get a notification with tracking info once it ships.",
          celebrationMessage: null,
          actionButton: null,
        };
      }
      return {
        statusLabel: "New order!",
        statusDescription: `${order.otherPartyName} ordered "${item}". Please dispatch within 3 business days.`,
        progressStep: 2,
        progressTotal: 5,
        nextAction: "Dispatch this order",
        timeRemaining: formatTimeRemaining(
          new Date(new Date(order.createdAt).getTime() + 3 * MS_PER_DAY),
        ),
        whatHappensNext: `Once you dispatch and add tracking, ${order.otherPartyName} will be notified. Payment is released after they confirm delivery.`,
        celebrationMessage: null,
        actionButton: { label: "Dispatch now", action: "dispatch" },
      };

    // ── DISPATCHED ────────────────────────────────────────────────
    case "dispatched":
      if (isBuyer) {
        const estDate = estimatedDeliveryDate
          ? new Date(estimatedDeliveryDate)
          : null;
        const isPastDue = estDate ? estDate.getTime() < Date.now() : false;
        const courierLabel = courier ?? "courier";

        return {
          statusLabel: isPastDue ? "Expected by now" : "On its way!",
          statusDescription: isPastDue
            ? `Your "${item}" was expected by ${estDate!.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" })}. Has it arrived?`
            : `Your "${item}" was shipped${courier ? ` via ${courierLabel}` : ""}${order.dispatchedAt ? ` on ${new Date(order.dispatchedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}` : ""}.`,
          progressStep: 3,
          progressTotal: 5,
          nextAction: "Confirm when your item arrives",
          timeRemaining:
            estDate && !isPastDue ? formatTimeRemaining(estDate) : null,
          whatHappensNext: estDate
            ? isPastDue
              ? "If your item hasn't arrived, you can confirm delivery when it does or report an issue."
              : `Expected delivery: ${estDate.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" })}. We'll remind you to confirm once it arrives.`
            : "Once it arrives, please confirm delivery so the seller gets paid.",
          celebrationMessage: null,
          actionButton: { label: "Confirm delivery", action: "confirm" },
        };
      }
      return {
        statusLabel: "Shipped",
        statusDescription: `Waiting for ${order.otherPartyName} to confirm delivery.${estimatedDeliveryDate ? ` Expected: ${new Date(estimatedDeliveryDate).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" })}.` : ""}`,
        progressStep: 3,
        progressTotal: 5,
        nextAction: `${order.otherPartyName} needs to confirm delivery`,
        timeRemaining: estimatedDeliveryDate
          ? formatTimeRemaining(new Date(estimatedDeliveryDate))
          : null,
        whatHappensNext: `Payment of ${price} will be released once ${order.otherPartyName} confirms delivery, or automatically after the confirmation window.`,
        celebrationMessage: null,
        actionButton: null,
      };

    // ── DELIVERED ─────────────────────────────────────────────────
    case "delivered":
      if (isBuyer) {
        return {
          statusLabel: "Delivered!",
          statusDescription:
            "Your item has been marked as delivered. Please confirm everything looks good.",
          progressStep: 4,
          progressTotal: 5,
          nextAction: "Confirm your delivery",
          timeRemaining: null,
          whatHappensNext:
            "Once you confirm, payment will be released to the seller.",
          celebrationMessage: null,
          actionButton: { label: "Confirm delivery", action: "confirm" },
        };
      }
      return {
        statusLabel: "Delivered",
        statusDescription: `The item has been delivered. Waiting for ${order.otherPartyName} to confirm.`,
        progressStep: 4,
        progressTotal: 5,
        nextAction: `${order.otherPartyName} needs to confirm receipt`,
        timeRemaining: null,
        whatHappensNext: `Payment of ${price} will be released once confirmed.`,
        celebrationMessage: null,
        actionButton: null,
      };

    // ── COMPLETED ─────────────────────────────────────────────────
    case "completed":
      if (isBuyer) {
        return {
          statusLabel: "Complete!",
          statusDescription: `Your order is complete. Payment of ${price} has been released to ${order.otherPartyName}.`,
          progressStep: 5,
          progressTotal: 5,
          nextAction: null,
          timeRemaining: null,
          whatHappensNext:
            "If you love your purchase, leave a review to help other buyers!",
          celebrationMessage: `Enjoy your "${item}"! We hope you love it.`,
          actionButton: { label: "Leave a review", action: "review" },
        };
      }
      return {
        statusLabel: "Payment released!",
        statusDescription: `${price} has been released to your account. It takes 2-3 business days to arrive.`,
        progressStep: 5,
        progressTotal: 5,
        nextAction: null,
        timeRemaining: null,
        whatHappensNext:
          "Your payout is being processed. Check your Stripe dashboard for details.",
        celebrationMessage: `Congratulations on the sale of "${item}"!`,
        actionButton: null,
      };

    // ── DISPUTED ──────────────────────────────────────────────────
    case "disputed": {
      const _hoursOpen = order.disputeOpenedAt
        ? Math.floor(
            (Date.now() - new Date(order.disputeOpenedAt).getTime()) /
              MS_PER_HOUR,
          )
        : 0;
      const sellerDeadline = order.disputeOpenedAt
        ? new Date(new Date(order.disputeOpenedAt).getTime() + 72 * MS_PER_HOUR)
        : null;
      const sellerHasResponded = !!order.sellerRespondedAt;

      if (isBuyer) {
        return {
          statusLabel: "Under review",
          statusDescription: sellerHasResponded
            ? `${order.otherPartyName} has responded to your report. Our team is reviewing the case.`
            : `We're looking into your report. ${order.otherPartyName} has ${sellerDeadline ? (formatTimeRemaining(sellerDeadline) ?? "time is up") : "72 hours"} to respond.`,
          progressStep: 3,
          progressTotal: 5,
          nextAction: null,
          timeRemaining:
            !sellerHasResponded && sellerDeadline
              ? formatTimeRemaining(sellerDeadline)
              : null,
          whatHappensNext: sellerHasResponded
            ? "Our Trust & Safety team will review both sides and reach a decision, usually within 24-48 hours."
            : "If the seller doesn't respond in time, the dispute will be resolved in your favour automatically.",
          celebrationMessage: null,
          actionButton: null,
        };
      }
      return {
        statusLabel: "Action needed!",
        statusDescription: sellerHasResponded
          ? "You've responded to the dispute. Our team is reviewing the case."
          : `The buyer reported an issue. Please respond within ${sellerDeadline ? (formatTimeRemaining(sellerDeadline) ?? "ASAP") : "72 hours"}.`,
        progressStep: 3,
        progressTotal: 5,
        nextAction: sellerHasResponded ? null : "Respond to the dispute",
        timeRemaining:
          !sellerHasResponded && sellerDeadline
            ? formatTimeRemaining(sellerDeadline)
            : null,
        whatHappensNext: sellerHasResponded
          ? "Our team will review both sides. You'll be notified of the decision."
          : "Providing a detailed response with evidence will help resolve this in your favour.",
        celebrationMessage: null,
        actionButton: sellerHasResponded
          ? null
          : { label: "Respond to dispute", action: "respondDispute" },
      };
    }

    // ── CANCELLED ─────────────────────────────────────────────────
    case "cancelled":
      return {
        statusLabel: "Cancelled",
        statusDescription: order.cancelReason
          ? `This order was cancelled${order.cancelledBy ? ` by the ${order.cancelledBy.toLowerCase()}` : ""}. Reason: ${order.cancelReason}`
          : `This order was cancelled${order.cancelledBy ? ` by the ${order.cancelledBy.toLowerCase()}` : ""}.`,
        progressStep: 0,
        progressTotal: 5,
        nextAction: null,
        timeRemaining: null,
        whatHappensNext: isBuyer
          ? "If you were charged, your refund will appear within 3-5 business days."
          : "The listing has been restored and is available for other buyers.",
        celebrationMessage: null,
        actionButton: null,
      };

    // ── REFUNDED ──────────────────────────────────────────────────
    case "refunded":
      return {
        statusLabel: "Refunded",
        statusDescription: isBuyer
          ? `A refund of ${price} has been issued to your original payment method.`
          : `This order has been refunded to the buyer (${price}).`,
        progressStep: 0,
        progressTotal: 5,
        nextAction: null,
        timeRemaining: null,
        whatHappensNext: isBuyer
          ? "Refunds usually take 3-5 business days to appear on your statement."
          : "The listing has been restored and is available for other buyers.",
        celebrationMessage: null,
        actionButton: null,
      };

    default:
      return {
        statusLabel: order.status,
        statusDescription: "Status information unavailable.",
        progressStep: 0,
        progressTotal: 5,
        nextAction: null,
        timeRemaining: null,
        whatHappensNext: "",
        celebrationMessage: null,
        actionButton: null,
      };
  }
}
