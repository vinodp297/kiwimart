"use client";
// src/app/(protected)/dashboard/buyer/_components/OrderCard.tsx

import { useState } from "react";
import Link from "next/link";
import { OrderStatusBadge, Button, Alert } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/utils";
import type { OrderStatus } from "@/types";
import type { BuyerOrderRow } from "@/server/actions/dashboard";
import { confirmDelivery } from "@/server/actions/orders";
import { getOrderStatusInfo } from "@/lib/orderStatusMessages";

export function OrderCard({
  order,
  onRefresh,
}: {
  order: BuyerOrderRow;
  onRefresh?: () => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleConfirmDelivery() {
    setActionLoading(true);
    setActionError(null);
    const result = await confirmDelivery(order.id);
    if (result.success) {
      setShowConfirm(false);
      onRefresh?.();
    } else {
      setActionError(
        result.error ?? "We couldn't confirm delivery. Please try again.",
      );
    }
    setActionLoading(false);
  }

  const isCompleted = order.status === "completed";
  const isPaymentHeld = order.status === "payment_held";

  const statusMsg = getOrderStatusInfo({
    status: order.status,
    total: order.total,
    createdAt: order.createdAt,
    dispatchedAt: order.dispatchedAt,
    completedAt: null,
    disputeOpenedAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancelledBy: null,
    trackingNumber: order.trackingNumber,
    sellerRespondedAt: null,
    listingTitle: order.listingTitle,
    otherPartyName: order.sellerName,
    isBuyer: true,
  });

  return (
    <>
      <article
        className="bg-white rounded-2xl border border-[#E3E0D9] p-5 flex flex-col
          sm:flex-row items-start sm:items-center gap-4"
      >
        <Link href={`/orders/${order.id}`} className="shrink-0">
          <img
            src={order.listingThumbnail}
            alt={order.listingTitle}
            className="w-16 h-16 rounded-xl object-cover border border-[#E3E0D9]"
          />
        </Link>

        <div className="flex-1 min-w-0">
          <Link
            href={`/orders/${order.id}`}
            className="text-[13.5px] font-semibold text-[#141414] hover:text-[#D4A843]
              transition-colors line-clamp-1"
          >
            {order.listingTitle}
          </Link>
          <div className="flex flex-wrap items-center gap-3 mt-1.5">
            <OrderStatusBadge status={order.status as OrderStatus} />
            {statusMsg.nextAction && (
              <span className="text-[11.5px] text-[#D4A843] font-medium">
                {statusMsg.nextAction}
              </span>
            )}
            {isPaymentHeld && !statusMsg.nextAction && (
              <span className="text-[11.5px] text-emerald-600 font-medium">
                Payment held securely
              </span>
            )}
            <span className="text-[12px] text-[#9E9A91]">
              Seller:{" "}
              <Link
                href={`/sellers/${order.sellerUsername}`}
                className="text-[#141414] font-medium hover:text-[#D4A843] transition-colors"
              >
                {order.sellerName}
              </Link>
            </span>
            <span className="text-[12px] text-[#9E9A91]">
              {new Date(order.createdAt).toLocaleDateString("en-NZ")}
            </span>
          </div>
          {order.trackingNumber && (
            <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[#73706A]">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              Tracking:{" "}
              {order.trackingUrl ? (
                <a
                  href={order.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#D4A843] hover:underline font-mono text-[11px]"
                >
                  {order.trackingNumber}
                </a>
              ) : (
                <span className="font-mono text-[11px]">
                  {order.trackingNumber}
                </span>
              )}
            </div>
          )}
          {order.status === "dispatched" && order.dispatchedAt && (
            <AutoReleaseCountdown dispatchedAt={order.dispatchedAt} />
          )}
        </div>

        <div className="flex flex-col items-end gap-2.5 shrink-0">
          <p
            className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold
            text-[#141414]"
          >
            {formatPrice(order.total)}
          </p>
          <div className="flex gap-2">
            {order.canConfirmDelivery && (
              <Button
                variant="gold"
                size="sm"
                onClick={() => setShowConfirm(true)}
              >
                Confirm delivery
              </Button>
            )}
            {order.canDispute && (
              <Link href={`/orders/${order.id}`}>
                <Button variant="ghost" size="sm">
                  Dispute
                </Button>
              </Link>
            )}
            {isCompleted && !order.hasReview && (
              <Link href={`/reviews/new?orderId=${order.id}`}>
                <Button variant="secondary" size="sm">
                  Leave a review
                </Button>
              </Link>
            )}
            {isCompleted && order.hasReview && (
              <span className="text-[11.5px] text-emerald-600 font-medium">
                Review submitted
              </span>
            )}
            <Link href={`/orders/${order.id}`}>
              <Button variant="secondary" size="sm">
                View
              </Button>
            </Link>
          </div>
        </div>
      </article>

      {/* Confirm delivery modal */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfirm(false);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#d97706"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2">
              Confirm delivery
            </h2>
            <p className="text-[13px] text-[#73706A] mb-6">
              Confirming releases payment to the seller. Only confirm if you
              have received the item.
            </p>
            {actionError && (
              <Alert variant="error" className="mb-4 text-left text-[13px]">
                {actionError}
              </Alert>
            )}
            <div className="flex gap-3 justify-center">
              <Button
                variant="gold"
                size="md"
                onClick={handleConfirmDelivery}
                loading={actionLoading}
              >
                Yes, I received it
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Auto-release countdown pill ───────────────────────────────────────────────

function AutoReleaseCountdown({ dispatchedAt }: { dispatchedAt: string }) {
  // Compute business-day-based release date client-side
  function addBusinessDays(date: Date, days: number): Date {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      const day = result.getDay();
      if (day !== 0 && day !== 6) added++;
    }
    return result;
  }

  const releaseDate = addBusinessDays(new Date(dispatchedAt), 4);
  const msRemaining = releaseDate.getTime() - Date.now();
  const daysRemaining = Math.max(
    0,
    Math.ceil(msRemaining / (1000 * 60 * 60 * 24)),
  );

  let cls = "text-[11.5px] font-medium";
  let label: string;
  if (daysRemaining === 0) {
    cls += " text-red-600 font-semibold";
    label = "Payment auto-releases today — please confirm delivery";
  } else if (daysRemaining === 1) {
    cls += " text-amber-600 font-semibold";
    label = `Payment auto-releases in ${daysRemaining} day — please confirm delivery`;
  } else {
    cls += " text-[#73706A]";
    label = `Payment auto-releases in ${daysRemaining} days if not confirmed`;
  }

  return <p className={`mt-1.5 ${cls}`}>⏱ {label}</p>;
}
