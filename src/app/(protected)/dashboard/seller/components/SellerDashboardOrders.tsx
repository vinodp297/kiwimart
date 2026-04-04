"use client";

import Link from "next/link";
import { Button, OrderStatusBadge, Alert } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/utils";
import { getOrderStatusInfo } from "@/lib/orderStatusMessages";
import type { SellerOrderRow } from "@/server/actions/dashboard";
import type { OrderStatus } from "@/types";

function SellerOrderCard({ order }: { order: SellerOrderRow }) {
  const statusMsg = getOrderStatusInfo({
    status: order.status,
    total: order.total,
    createdAt: order.createdAt,
    dispatchedAt: null,
    completedAt: null,
    disputeOpenedAt: order.disputeOpenedAt,
    cancelledAt: null,
    cancelReason: null,
    cancelledBy: null,
    trackingNumber: order.trackingNumber,
    sellerRespondedAt: null,
    listingTitle: order.listingTitle,
    otherPartyName: order.buyerName,
    isBuyer: false,
  });

  const disputeCountdown = (() => {
    if (
      order.status !== "disputed" ||
      order.sellerResponse ||
      !order.disputeOpenedAt
    )
      return null;
    const deadline =
      new Date(order.disputeOpenedAt).getTime() + 72 * 60 * 60 * 1000;
    const diff = deadline - Date.now();
    if (diff <= 0)
      return {
        label: "Overdue",
        colour: "bg-red-100 text-red-700 border-red-200",
      };
    const hours = Math.floor(diff / (60 * 60 * 1000));
    if (hours < 12)
      return {
        label: `Respond in ${hours}h`,
        colour: "bg-red-100 text-red-700 border-red-200",
      };
    if (hours < 24)
      return {
        label: `Respond in ${hours}h`,
        colour: "bg-amber-100 text-amber-700 border-amber-200",
      };
    return {
      label: `Respond in ${hours}h`,
      colour: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  })();

  return (
    <article
      className="bg-white rounded-2xl border border-[#E3E0D9] p-5
        flex flex-col sm:flex-row items-start sm:items-center gap-4"
    >
      <img
        src={order.listingThumbnail}
        alt={order.listingTitle}
        className="w-14 h-14 rounded-xl object-cover border border-[#E3E0D9] shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold text-[#141414] line-clamp-1">
          {order.listingTitle}
        </p>
        <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
          <OrderStatusBadge status={order.status as OrderStatus} />
          {disputeCountdown && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${disputeCountdown.colour}`}
            >
              ⏳ {disputeCountdown.label}
            </span>
          )}
          <span className="text-[12px] text-[#9E9A91]">
            Buyer: <strong className="text-[#141414]">{order.buyerName}</strong>
          </span>
          <span className="text-[12px] text-[#9E9A91]">
            {new Date(order.createdAt).toLocaleDateString("en-NZ")}
          </span>
        </div>
        {order.trackingNumber && (
          <p className="text-[11.5px] text-[#73706A] mt-1.5">
            Tracking: <span className="font-mono">{order.trackingNumber}</span>
          </p>
        )}
        {statusMsg.nextAction && (
          <p
            className={`text-[11.5px] font-medium mt-1 ${order.status === "payment_held" ? "text-[#D4A843]" : "text-amber-600"}`}
          >
            {statusMsg.nextAction}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-2.5 shrink-0">
        <p className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
          {formatPrice(order.total)}
        </p>
        <div className="flex gap-2">
          {order.status === "payment_held" && (
            <Link href={`/orders/${order.id}`}>
              <Button variant="gold" size="sm">
                Mark dispatched
              </Button>
            </Link>
          )}
          <Link href={`/orders/${order.id}`}>
            <Button variant="secondary" size="sm">
              View details
            </Button>
          </Link>
        </div>
      </div>
    </article>
  );
}

interface Props {
  orders: SellerOrderRow[];
  pendingOrders: SellerOrderRow[];
}

export default function SellerDashboardOrders({
  orders,
  pendingOrders,
}: Props) {
  return (
    <div role="tabpanel" aria-label="Orders" className="space-y-3">
      {pendingOrders.length > 0 && (
        <Alert variant="warning">
          You have <strong>{pendingOrders.length}</strong> order
          {pendingOrders.length > 1 ? "s" : ""} awaiting action. Dispatch
          promptly to maintain your seller rating.
        </Alert>
      )}

      {orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-12 text-center">
          <p className="text-[14px] text-[#9E9A91]">No orders yet</p>
        </div>
      ) : (
        orders.map((order) => <SellerOrderCard key={order.id} order={order} />)
      )}
    </div>
  );
}
