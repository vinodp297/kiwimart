"use client";

import { formatPrice } from "@/lib/utils";
import type { OrderDetailData, TimelineEvent } from "./order-types";
import { getCourierUrl } from "./order-utils";
import {
  CreditCardIcon,
  ShieldIcon,
  PackageIcon,
  TruckIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  RefundIcon,
  XCircleIcon,
} from "./order-icons";
import { getOrderStatusInfo } from "@/lib/orderStatusMessages";

// ── Status info messages ─────────────────────────────────────────────────────
function getStatusInfo(order: OrderDetailData): {
  icon: React.ReactNode;
  title: string;
  message: string;
  colour: string;
} | null {
  const isBuyer = order.isBuyer;

  switch (order.status) {
    case "awaiting_payment":
      return {
        icon: <CreditCardIcon />,
        title: "Awaiting payment",
        message:
          "Your payment is being processed. This usually takes a few seconds.",
        colour: "bg-amber-50 border-amber-200 text-amber-800",
      };
    case "payment_held":
      return isBuyer
        ? {
            icon: <ShieldIcon />,
            title: "Payment secured",
            message: `Your payment of ${formatPrice(order.total)} is held safely. It will be released to the seller once you confirm delivery.`,
            colour: "bg-sky-50 border-sky-200 text-sky-800",
          }
        : {
            icon: <PackageIcon />,
            title: "Payment received — time to ship!",
            message: `The buyer has paid ${formatPrice(order.total)}. Please dispatch the item and add a tracking number.`,
            colour: "bg-emerald-50 border-emerald-200 text-emerald-800",
          };
    case "dispatched":
      return isBuyer
        ? {
            icon: <TruckIcon />,
            title: "Item on its way",
            message:
              "The seller has dispatched your item. Please confirm delivery once it arrives.",
            colour: "bg-sky-50 border-sky-200 text-sky-800",
          }
        : {
            icon: <TruckIcon />,
            title: "Item dispatched",
            message:
              "Waiting for the buyer to confirm delivery. Payment will be released once confirmed.",
            colour: "bg-sky-50 border-sky-200 text-sky-800",
          };
    case "delivered":
      return isBuyer
        ? {
            icon: <CheckCircleIcon />,
            title: "Item delivered",
            message:
              "Your item has been marked as delivered. Please confirm receipt to release payment.",
            colour: "bg-emerald-50 border-emerald-200 text-emerald-800",
          }
        : {
            icon: <CheckCircleIcon />,
            title: "Delivered",
            message:
              "The item has been delivered. Waiting for buyer confirmation to release your payment.",
            colour: "bg-emerald-50 border-emerald-200 text-emerald-800",
          };
    case "completed":
      return {
        icon: <CheckCircleIcon />,
        title: "Order complete",
        message: isBuyer
          ? "This order is complete. Payment has been released to the seller."
          : `This order is complete. ${formatPrice(order.total)} has been released to your account.`,
        colour: "bg-emerald-50 border-emerald-200 text-emerald-800",
      };
    case "disputed":
      return {
        icon: <AlertTriangleIcon />,
        title: "Dispute in progress",
        message:
          "Our Trust & Safety team is reviewing this case. We aim to resolve disputes within 48 hours.",
        colour: "bg-red-50 border-red-200 text-red-800",
      };
    case "refunded":
      return {
        icon: <RefundIcon />,
        title: "Refunded",
        message: isBuyer
          ? `A refund of ${formatPrice(order.total)} has been issued to your original payment method.`
          : "This order has been refunded to the buyer.",
        colour: "bg-violet-50 border-violet-200 text-violet-800",
      };
    case "cancelled":
      return {
        icon: <XCircleIcon />,
        title: "Order cancelled",
        message: order.cancelReason
          ? `This order was cancelled. Reason: ${order.cancelReason}`
          : "This order has been cancelled.",
        colour: "bg-neutral-50 border-neutral-200 text-neutral-700",
      };
    default:
      return null;
  }
}

export default function OrderStatusCard({
  order,
  timelineEvents,
}: {
  order: OrderDetailData;
  timelineEvents: TimelineEvent[];
}) {
  const statusInfo = getStatusInfo(order);

  // Rich status messages for "what happens next" card
  const dispatchEvent = timelineEvents.find((e) => e.type === "DISPATCHED");
  const dispatchMeta = (dispatchEvent?.metadata ?? {}) as Record<
    string,
    unknown
  >;
  const richStatus = getOrderStatusInfo(
    {
      status: order.status,
      total: order.total,
      createdAt: order.createdAt,
      dispatchedAt: order.dispatchedAt,
      completedAt: order.completedAt,
      disputeOpenedAt: order.dispute?.openedAt ?? null,
      cancelledAt: order.cancelledAt,
      cancelReason: order.cancelReason,
      cancelledBy: order.cancelledBy,
      trackingNumber: order.trackingNumber,
      sellerRespondedAt: order.dispute?.sellerRespondedAt ?? null,
      listingTitle: order.listingTitle,
      otherPartyName: order.otherPartyName,
      isBuyer: order.isBuyer,
    },
    dispatchMeta.estimatedDeliveryDate as string | null,
    dispatchMeta.courier as string | null,
  );

  return (
    <>
      {/* ── Status info box ───────────────────────────────────── */}
      {statusInfo && (
        <div
          className={`rounded-2xl border p-4 mb-6 flex items-start gap-3 ${statusInfo.colour}`}
        >
          <div className="shrink-0 mt-0.5">{statusInfo.icon}</div>
          <div>
            <p className="text-[13.5px] font-semibold mb-0.5">
              {statusInfo.title}
            </p>
            <p className="text-[12.5px] leading-relaxed opacity-80">
              {statusInfo.message}
            </p>
          </div>
        </div>
      )}

      {/* ── Rich status card with progress + "what happens next" ─── */}
      {richStatus.whatHappensNext && (
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5 mb-6">
          {/* Progress bar */}
          {richStatus.progressStep > 0 && richStatus.progressTotal > 0 && (
            <div className="mb-4">
              <div className="flex justify-between text-[11px] text-[#9E9A91] mb-1.5">
                <span>
                  Step {richStatus.progressStep} of {richStatus.progressTotal}
                </span>
                {richStatus.timeRemaining && (
                  <span className="text-[#D4A843] font-medium">
                    {richStatus.timeRemaining} remaining
                  </span>
                )}
              </div>
              <div className="h-1.5 bg-[#F0EDE8] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#D4A843] rounded-full transition-all duration-500"
                  style={{
                    width: `${(richStatus.progressStep / richStatus.progressTotal) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Celebration message */}
          {richStatus.celebrationMessage && (
            <p className="text-[13.5px] font-semibold text-emerald-700 mb-2">
              {richStatus.celebrationMessage}
            </p>
          )}

          {/* What happens next */}
          <div className="flex items-start gap-2">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#D4A843"
              strokeWidth="2"
              className="shrink-0 mt-0.5"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <p className="text-[12.5px] text-[#73706A] leading-relaxed">
              {richStatus.whatHappensNext}
            </p>
          </div>

          {/* Tracking info for dispatched orders */}
          {order.status === "dispatched" && order.trackingNumber && (
            <div className="mt-3 p-3 bg-[#FAFAF8] rounded-xl border border-[#E3E0D9] flex items-center justify-between">
              <div className="text-[12.5px]">
                <span className="text-[#9E9A91]">Tracking: </span>
                {order.trackingUrl ? (
                  <a
                    href={order.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#D4A843] font-medium hover:underline font-mono"
                  >
                    {order.trackingNumber}
                  </a>
                ) : (
                  <a
                    href={getCourierUrl(order.trackingNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#D4A843] font-medium hover:underline font-mono"
                  >
                    {order.trackingNumber}
                  </a>
                )}
                {!!dispatchMeta.courier && (
                  <span className="text-[#9E9A91]">
                    {" "}
                    via {String(dispatchMeta.courier)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
