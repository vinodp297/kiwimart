"use client";

import Link from "next/link";
import { OrderStatusBadge, Alert } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/utils";
import type { OrderStatus } from "@/types";
import type { OrderDetailData } from "./order-types";
import { PickupStatusBanner } from "@/components/pickup/PickupStatusBanner";

export default function OrderHeader({
  order,
  actionSuccess,
  error,
}: {
  order: OrderDetailData;
  actionSuccess: string | null;
  error: string | null;
}) {
  return (
    <>
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-[12.5px] text-[#9E9A91] mb-6">
        <Link
          href={order.isBuyer ? "/dashboard/buyer" : "/dashboard/seller"}
          className="hover:text-[#D4A843] transition-colors"
        >
          Dashboard
        </Link>
        <span>/</span>
        <span className="text-[#141414] font-medium">
          Order {order.id.slice(0, 8)}…
        </span>
      </nav>

      {actionSuccess && (
        <Alert variant="success" className="mb-4">
          {actionSuccess}
        </Alert>
      )}
      {error && (
        <Alert variant="error" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Order header */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <Link href={`/listings/${order.listingId}`} className="shrink-0">
            <img
              src={order.listingThumbnail}
              alt={order.listingTitle}
              className="w-20 h-20 rounded-xl object-cover border border-[#E3E0D9]"
            />
          </Link>
          <div className="flex-1">
            <Link
              href={`/listings/${order.listingId}`}
              className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] hover:text-[#D4A843] transition-colors"
            >
              {order.listingTitle}
            </Link>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <OrderStatusBadge status={order.status as OrderStatus} />
              <span className="text-[12px] text-[#9E9A91]">
                {new Date(order.createdAt).toLocaleDateString("en-NZ", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-bold text-[#141414]">
              {formatPrice(order.total)}
            </p>
            <p className="text-[11px] text-[#9E9A91]">NZD</p>
          </div>
        </div>
      </div>

      {/* ── Pickup Status Banner ──────────────────────────────────────── */}
      {order.fulfillmentType !== "SHIPPED" && (
        <div className="mb-4">
          <PickupStatusBanner
            pickupStatus={order.pickupStatus}
            fulfillmentType={order.fulfillmentType}
            pickupScheduledAt={order.pickupScheduledAt}
            pickupWindowExpiresAt={order.pickupWindowExpiresAt}
            otpExpiresAt={order.otpExpiresAt}
            rescheduleCount={order.rescheduleCount}
            userRole={order.isBuyer ? "BUYER" : "SELLER"}
            orderId={order.id}
            listingTitle={order.listingTitle}
          />
        </div>
      )}
    </>
  );
}
