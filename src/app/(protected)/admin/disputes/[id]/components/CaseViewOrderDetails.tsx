"use client";
// src/app/(protected)/admin/disputes/[id]/components/CaseViewOrderDetails.tsx
// ─── Pickup Details section (only rendered for non-shipped orders) ────────────

import { Section } from "./case-view-shared";
import { fmtDateTime } from "./case-view-types";
import type { CaseData } from "./case-view-types";

interface Props {
  order: CaseData["order"];
}

export default function CaseViewOrderDetails({ order }: Props) {
  if (!order.fulfillmentType || order.fulfillmentType === "SHIPPED") {
    return null;
  }

  return (
    <Section title="Pickup Details">
      <div className="space-y-2 text-[13px]">
        <div className="flex gap-2 flex-wrap">
          <span className="inline-flex items-center text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
            {order.fulfillmentType === "CASH_ON_PICKUP"
              ? "Cash on Pickup"
              : "Online Payment Pickup"}
          </span>
          {order.pickupStatus && (
            <span className="inline-flex items-center text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
              {order.pickupStatus.replace(/_/g, " ")}
            </span>
          )}
        </div>
        {order.pickupScheduledAt && (
          <p className="text-[#73706A]">
            <strong>Scheduled:</strong> {fmtDateTime(order.pickupScheduledAt)}
          </p>
        )}
        {order.otpInitiatedAt && (
          <p className="text-[#73706A]">
            <strong>OTP Initiated:</strong> {fmtDateTime(order.otpInitiatedAt)}
          </p>
        )}
        {order.pickupConfirmedAt && (
          <p className="text-[#73706A]">
            <strong>Confirmed:</strong> {fmtDateTime(order.pickupConfirmedAt)}
          </p>
        )}
        {order.pickupRejectedAt && (
          <p className="text-red-600">
            <strong>Rejected at pickup:</strong>{" "}
            {fmtDateTime(order.pickupRejectedAt)}
          </p>
        )}
        {order.rescheduleCount != null && order.rescheduleCount > 0 && (
          <p className="text-[#73706A]">
            <strong>Reschedules:</strong> {order.rescheduleCount}
          </p>
        )}
        {(order.pickupStatus === "SELLER_NO_SHOW" ||
          order.pickupStatus === "BUYER_NO_SHOW") && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
            {order.pickupStatus === "SELLER_NO_SHOW"
              ? "Seller did not show up for the scheduled pickup. Order was auto-cancelled and buyer refunded."
              : "Buyer did not enter the OTP code within the allowed time. Payment was auto-released to seller."}
          </div>
        )}
        {/* Reschedule history */}
        {order.pickupRescheduleRequests &&
          order.pickupRescheduleRequests.length > 0 && (
            <div className="mt-3 border-t border-[#E3E0D9] pt-3">
              <p className="text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-2">
                Reschedule History
              </p>
              <div className="space-y-2">
                {order.pickupRescheduleRequests.map((req) => (
                  <div
                    key={req.id}
                    className="rounded-lg bg-[#F8F7F4] p-2.5 text-[12px] border border-[#E3E0D9]"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[#141414]">
                        {req.requestedBy.displayName ?? "User"} (
                        {req.requestedByRole})
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          req.status === "ACCEPTED"
                            ? "bg-green-100 text-green-700"
                            : req.status === "REJECTED"
                              ? "bg-red-100 text-red-700"
                              : req.status === "EXPIRED"
                                ? "bg-gray-100 text-gray-600"
                                : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>
                    <p className="text-[#73706A] mt-0.5">
                      Reason:{" "}
                      {(req.sellerReason ?? req.buyerReason ?? "—").replace(
                        /_/g,
                        " ",
                      )}
                      {req.reasonNote && ` — "${req.reasonNote}"`}
                    </p>
                    <p className="text-[#9E9A91] mt-0.5">
                      Proposed: {fmtDateTime(req.proposedTime)} · Requested:{" "}
                      {fmtDateTime(req.createdAt)}
                      {req.respondedAt &&
                        ` · Responded: ${fmtDateTime(req.respondedAt)}`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>
    </Section>
  );
}
