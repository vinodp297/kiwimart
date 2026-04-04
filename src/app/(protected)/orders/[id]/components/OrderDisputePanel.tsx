"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/primitives";
import type { OrderDetailData, TimelineEvent } from "./order-types";
import { fmtDate } from "./order-utils";
import { getOrderStatusInfo } from "@/lib/orderStatusMessages";
import OrderCounterEvidence from "./OrderCounterEvidence";

function DisputeCountdownTimer({
  disputeOpenedAt,
}: {
  disputeOpenedAt: string;
}) {
  const [remaining, setRemaining] = useState<{
    hours: number;
    minutes: number;
    expired: boolean;
  }>({ hours: 0, minutes: 0, expired: false });

  useEffect(() => {
    function calc() {
      const deadline =
        new Date(disputeOpenedAt).getTime() + 72 * 60 * 60 * 1000;
      const diff = deadline - Date.now();
      if (diff <= 0) return { hours: 0, minutes: 0, expired: true };
      const hours = Math.floor(diff / (60 * 60 * 1000));
      const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
      return { hours, minutes, expired: false };
    }
    setRemaining(calc());
    const interval = setInterval(() => setRemaining(calc()), 60_000);
    return () => clearInterval(interval);
  }, [disputeOpenedAt]);

  if (remaining.expired) {
    return (
      <div className="p-3 rounded-xl bg-red-100 border border-red-300 text-[12.5px] text-red-800">
        <p className="font-semibold">⏰ Response deadline has passed</p>
        <p className="mt-0.5 text-[11.5px] opacity-80">
          The dispute may be resolved in the buyer&apos;s favour. You can still
          submit a response.
        </p>
      </div>
    );
  }

  const colour =
    remaining.hours >= 24
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : remaining.hours >= 12
        ? "bg-amber-50 border-amber-200 text-amber-800"
        : "bg-red-50 border-red-200 text-red-800";

  return (
    <div className={`p-3 rounded-xl border text-[12.5px] ${colour}`}>
      <p className="font-semibold">
        ⏳ You have {remaining.hours}h {remaining.minutes}m to respond
      </p>
      <p className="mt-0.5 text-[11.5px] opacity-80">
        If you don&apos;t respond, the dispute may be resolved in the
        buyer&apos;s favour.
      </p>
    </div>
  );
}

export default function OrderDisputePanel({
  order,
  timelineEvents,
  showCounterEvidence,
  onSetShowCounterEvidence,
  counterDescription,
  onSetCounterDescription,
  counterPhotos,
  counterPhotoKeys,
  uploadingCounter,
  submittingCounter,
  onUploadCounterPhotos,
  onRemoveCounterPhoto,
  onSubmitCounterEvidence,
  showSellerResponse,
  onSetShowSellerResponse,
  sellerResponseText,
  onSetSellerResponseText,
  onSubmitSellerResponse,
  actionLoading,
}: {
  order: OrderDetailData;
  timelineEvents: TimelineEvent[];
  showCounterEvidence: boolean;
  onSetShowCounterEvidence: (v: boolean) => void;
  counterDescription: string;
  onSetCounterDescription: (v: string) => void;
  counterPhotos: File[];
  counterPhotoKeys: string[];
  uploadingCounter: boolean;
  submittingCounter: boolean;
  onUploadCounterPhotos: (files: File[]) => void;
  onRemoveCounterPhoto: (index: number) => void;
  onSubmitCounterEvidence: () => void;
  showSellerResponse: boolean;
  onSetShowSellerResponse: (v: boolean) => void;
  sellerResponseText: string;
  onSetSellerResponseText: (v: string) => void;
  onSubmitSellerResponse: () => void;
  actionLoading: boolean;
}) {
  if (order.status !== "disputed") return null;

  // Rich status for "what happens next" in dispute card
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
      <OrderCounterEvidence
        order={order}
        timelineEvents={timelineEvents}
        showCounterEvidence={showCounterEvidence}
        onSetShowCounterEvidence={onSetShowCounterEvidence}
        counterDescription={counterDescription}
        onSetCounterDescription={onSetCounterDescription}
        counterPhotos={counterPhotos}
        counterPhotoKeys={counterPhotoKeys}
        uploadingCounter={uploadingCounter}
        submittingCounter={submittingCounter}
        onUploadCounterPhotos={onUploadCounterPhotos}
        onRemoveCounterPhoto={onRemoveCounterPhoto}
        onSubmitCounterEvidence={onSubmitCounterEvidence}
      />

      {/* ── Dispute transparency card ── */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5 mb-6">
        <h3 className="text-[13.5px] font-semibold text-[#141414] mb-3">
          Dispute status
        </h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="text-[#9E9A91]">Status:</span>
            <span
              className={`font-medium ${order.dispute?.sellerRespondedAt ? "text-sky-700" : "text-amber-700"}`}
            >
              {order.dispute?.sellerRespondedAt
                ? "Under review"
                : "Awaiting seller response"}
            </span>
          </div>
          {order.dispute?.reason && (
            <div className="text-[12.5px]">
              <span className="text-[#9E9A91]">Reason: </span>
              <span className="text-[#141414]">
                {order.dispute?.reason.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>
          )}
          {order.dispute?.buyerStatement && (
            <div className="text-[12.5px]">
              <span className="text-[#9E9A91]">Description: </span>
              <span className="text-[#141414] line-clamp-3">
                {order.dispute?.buyerStatement}
              </span>
            </div>
          )}
          {order.dispute?.sellerRespondedAt &&
            order.dispute?.sellerStatement && (
              <div className="bg-[#FAFAF8] rounded-xl p-3 border border-[#E3E0D9]">
                <p className="text-[11.5px] text-[#9E9A91] font-medium mb-1">
                  Seller response (
                  {new Date(
                    order.dispute?.sellerRespondedAt,
                  ).toLocaleDateString("en-NZ", {
                    day: "numeric",
                    month: "short",
                  })}
                  )
                </p>
                <p className="text-[12.5px] text-[#141414] line-clamp-4">
                  {order.dispute?.sellerStatement}
                </p>
              </div>
            )}
          <div className="bg-sky-50 rounded-xl p-3 border border-sky-100">
            <p className="text-[12px] text-sky-800">
              {richStatus.whatHappensNext}
            </p>
          </div>
        </div>
      </div>

      {/* Dispute details + seller response form */}
      <div className="mb-6">
        <div className="mt-5 space-y-3">
          {!order.isBuyer &&
            !order.dispute?.sellerStatement &&
            order.dispute?.openedAt && (
              <DisputeCountdownTimer
                disputeOpenedAt={order.dispute!.openedAt}
              />
            )}

          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[12.5px] text-red-800">
            <p className="font-semibold mb-1">Dispute details</p>
            {order.dispute?.reason && (
              <p>
                Reason: {order.dispute?.reason.replace(/_/g, " ").toLowerCase()}
              </p>
            )}
            {order.dispute?.buyerStatement && (
              <p className="mt-1.5 whitespace-pre-wrap">
                {order.dispute?.buyerStatement}
              </p>
            )}
          </div>

          {order.dispute?.sellerStatement && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12.5px] text-amber-900">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Seller response
              </p>
              <p className="whitespace-pre-wrap">
                {order.dispute?.sellerStatement}
              </p>
              {order.dispute?.sellerRespondedAt && (
                <p className="mt-1.5 text-[11px] opacity-60">
                  Responded {fmtDate(order.dispute?.sellerRespondedAt)}
                </p>
              )}
            </div>
          )}

          {!order.isBuyer &&
            !order.dispute?.sellerStatement &&
            !showSellerResponse && (
              <button
                type="button"
                onClick={() => onSetShowSellerResponse(true)}
                className="w-full p-3 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/50 text-[12.5px] text-amber-800 font-semibold hover:bg-amber-50 transition-colors"
              >
                Respond to this dispute →
              </button>
            )}

          {!order.isBuyer &&
            !order.dispute?.sellerStatement &&
            showSellerResponse && (
              <div className="p-4 rounded-xl bg-white border border-[#E3E0D9]">
                <label className="text-[12.5px] font-semibold text-[#141414] mb-1.5 block">
                  Your response
                </label>
                <textarea
                  value={sellerResponseText}
                  onChange={(e) => onSetSellerResponseText(e.target.value)}
                  placeholder="Explain your side of the situation (min 20 characters)..."
                  rows={4}
                  maxLength={2000}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
                />
                <p className="text-[11px] text-[#9E9A91] mt-1 mb-3">
                  {sellerResponseText.length}/2000 characters
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="gold"
                    size="sm"
                    onClick={onSubmitSellerResponse}
                    loading={actionLoading}
                  >
                    Submit response
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onSetShowSellerResponse(false);
                      onSetSellerResponseText("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                <p className="text-[11px] text-[#9E9A91] mt-2">
                  Your response will be shared with the buyer and our Trust
                  &amp; Safety team.
                </p>
              </div>
            )}
        </div>
      </div>
    </>
  );
}
