"use client";

import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import type { OrderDetailData, InteractionData } from "./order-types";

export default function OrderActions({
  order,
  pendingCancelRequest,
  pendingReturnRequest,
  pendingPartialRefund,
  pendingShippingDelay,
  onShowDispatch,
  onShowConfirm,
  onShowDispute,
  onShowCancelRequest,
  onShowReturnRequest,
  onShowPartialRefund,
  onShowShippingDelay,
  onShowProblemResolver,
}: {
  order: OrderDetailData;
  pendingCancelRequest: InteractionData | undefined;
  pendingReturnRequest: InteractionData | undefined;
  pendingPartialRefund: InteractionData | undefined;
  pendingShippingDelay: InteractionData | undefined;
  onShowDispatch: () => void;
  onShowConfirm: () => void;
  onShowDispute: () => void;
  onShowCancelRequest: () => void;
  onShowReturnRequest: () => void;
  onShowPartialRefund: () => void;
  onShowShippingDelay: () => void;
  onShowProblemResolver: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {/* Seller: mark dispatched */}
      {!order.isBuyer && order.status === "payment_held" && (
        <Button variant="gold" size="md" onClick={onShowDispatch}>
          Mark as dispatched
        </Button>
      )}

      {/* Buyer: confirm delivery */}
      {order.isBuyer &&
        (order.status === "dispatched" || order.status === "delivered") && (
          <Button variant="gold" size="md" onClick={onShowConfirm}>
            Confirm delivery
          </Button>
        )}

      {/* Buyer: open dispute */}
      {order.isBuyer &&
        (order.status === "dispatched" || order.status === "delivered") &&
        !order.dispute?.reason && (
          <Button variant="ghost" size="md" onClick={onShowDispute}>
            Open a dispute
          </Button>
        )}

      {/* Cancel order — interaction-based flow */}
      {(order.status === "payment_held" ||
        order.status === "awaiting_payment") &&
        !pendingCancelRequest && (
          <Button variant="danger" size="md" onClick={onShowCancelRequest}>
            Request cancellation
          </Button>
        )}

      {/* Buyer: request return (completed/delivered) */}
      {order.isBuyer &&
        (order.status === "completed" || order.status === "delivered") &&
        !pendingReturnRequest && (
          <Button variant="secondary" size="md" onClick={onShowReturnRequest}>
            Request return
          </Button>
        )}

      {/* Buyer or Seller: request partial refund (completed/delivered) */}
      {(order.status === "completed" || order.status === "delivered") &&
        !pendingPartialRefund && (
          <Button variant="secondary" size="md" onClick={onShowPartialRefund}>
            {order.isBuyer ? "Request partial refund" : "Offer partial refund"}
          </Button>
        )}

      {/* Seller: notify shipping delay (before dispatch) */}
      {!order.isBuyer &&
        (order.status === "payment_held" ||
          order.status === "awaiting_payment") &&
        !pendingShippingDelay && (
          <Button variant="secondary" size="md" onClick={onShowShippingDelay}>
            Notify shipping delay
          </Button>
        )}

      {/* Buyer: leave review */}
      {order.isBuyer &&
        order.status === "completed" &&
        !order.hasBuyerReview && (
          <Link href={`/reviews/new?orderId=${order.id}`}>
            <Button variant="secondary" size="md">
              Leave a review
            </Button>
          </Link>
        )}

      {/* Seller: review buyer */}
      {!order.isBuyer &&
        order.status === "completed" &&
        !order.hasSellerReview && (
          <Link href={`/reviews/new?orderId=${order.id}&role=seller`}>
            <Button variant="secondary" size="md">
              Review buyer
            </Button>
          </Link>
        )}

      {/* Message — hidden for cancelled/refunded orders */}
      {order.status !== "cancelled" && order.status !== "refunded" && (
        <Link
          href={`/messages/new?listingId=${order.listingId}&sellerId=${order.isBuyer ? order.sellerId : order.buyerId}&orderContext=${order.status}&itemName=${encodeURIComponent(order.listingTitle)}`}
        >
          <Button variant="secondary" size="md">
            Message {order.isBuyer ? "seller" : "buyer"}
          </Button>
        </Link>
      )}

      {/* Buyer: unified "Need help?" */}
      {order.isBuyer &&
        !["awaiting_payment", "cancelled", "refunded"].includes(order.status) &&
        !order.dispute?.reason && (
          <button
            type="button"
            onClick={onShowProblemResolver}
            className="text-[12.5px] text-[#9E9A91] hover:text-[#D4A843] font-medium transition flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Need help with this order?
          </button>
        )}
    </div>
  );
}
