"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import type { OrderDetailData } from "./order-types";
import { getCourierUrl } from "./order-utils";
import { XCircleIcon } from "./order-icons";

export default function OrderPaymentDetails({
  order,
}: {
  order: OrderDetailData;
}) {
  const isCancelled = order.status === "cancelled";

  return (
    <>
      {/* Price breakdown + details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
          <h3 className="text-[13px] font-semibold text-[#141414] mb-3">
            Price breakdown
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between text-[13px]">
              <span className="text-[#73706A]">Item</span>
              <span className="text-[#141414]">
                {formatPrice(order.itemPrice)}
              </span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-[#73706A]">Shipping</span>
              <span className="text-[#141414]">
                {order.shippingPrice === 0
                  ? "Free"
                  : formatPrice(order.shippingPrice)}
              </span>
            </div>
            <div className="flex justify-between text-[14px] font-semibold pt-2 border-t border-[#F0EDE8]">
              <span className="text-[#141414]">Total</span>
              <span className="text-[#141414]">{formatPrice(order.total)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
          <h3 className="text-[13px] font-semibold text-[#141414] mb-3">
            {order.isBuyer ? "Seller" : "Buyer"}
          </h3>
          <p className="text-[13px] text-[#141414] font-medium">
            {order.otherPartyName}
          </p>
          <Link
            href={order.isBuyer ? `/sellers/${order.otherPartyUsername}` : "#"}
            className="text-[12px] text-[#D4A843] hover:text-[#B8912E] transition-colors"
          >
            @{order.otherPartyUsername}
          </Link>
          {order.trackingNumber && (
            <div className="mt-3 pt-3 border-t border-[#F0EDE8]">
              <p className="text-[11.5px] font-semibold text-[#141414] mb-1">
                Tracking
              </p>
              <a
                href={order.trackingUrl || getCourierUrl(order.trackingNumber)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-[#D4A843] font-mono hover:underline inline-flex items-center gap-1"
              >
                {order.trackingNumber}
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Cancellation audit trail */}
      {isCancelled && (order.cancelReason || order.cancelledAt) && (
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5 mb-6">
          <h3 className="text-[13px] font-semibold text-[#141414] mb-3 flex items-center gap-2">
            <XCircleIcon />
            Cancellation details
          </h3>
          <div className="space-y-1.5 text-[12.5px] text-[#73706A]">
            {order.cancelledAt && (
              <p>
                Cancelled on:{" "}
                {new Date(order.cancelledAt).toLocaleDateString("en-NZ", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
            {order.cancelledBy && (
              <p>
                Cancelled by:{" "}
                {order.cancelledBy === "BUYER"
                  ? "Buyer"
                  : order.cancelledBy === "SELLER"
                    ? "Seller"
                    : "System"}
              </p>
            )}
            {order.cancelReason && <p>Reason: {order.cancelReason}</p>}
          </div>
        </div>
      )}
    </>
  );
}
