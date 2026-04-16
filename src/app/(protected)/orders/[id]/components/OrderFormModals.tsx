"use client";

import { Button, Alert } from "@/components/ui/primitives";
import type { OrderDetailData } from "./order-types";
import { ModalOverlay } from "./order-icons";
import ProblemResolver from "@/components/ProblemResolver";

// ── Cancellation Request Modal ───────────────────────────────────────────────
export function CancellationModal({
  cancelRequestReason,
  onSetCancelRequestReason,
  onSubmit,
  onClose,
  actionLoading,
}: {
  cancelRequestReason: string;
  onSetCancelRequestReason: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  actionLoading: boolean;
}) {
  return (
    <ModalOverlay onClose={onClose} labelledById="cancel-modal-title">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <svg
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#dc2626"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
        </div>
        <h2
          id="cancel-modal-title"
          className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2"
        >
          Request cancellation
        </h2>
        <p className="text-[13px] text-[#73706A] mb-4">
          The other party has 48 hours to accept or reject your request.
        </p>
        <div className="text-left mb-4">
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            Reason for cancellation
          </label>
          <textarea
            value={cancelRequestReason}
            onChange={(e) => onSetCancelRequestReason(e.target.value)}
            placeholder="Please explain why you need to cancel (min 10 characters)..."
            rows={3}
            maxLength={500}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
          />
          <p className="text-[11px] text-[#9E9A91] mt-1">
            {cancelRequestReason.length}/500 characters
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-4 text-left">
          <p className="text-[12px] text-amber-800 font-semibold">
            What happens next?
          </p>
          <p className="text-[11.5px] text-amber-700 mt-1">
            If you are within the free-cancellation window, the order is
            cancelled immediately and a full refund is issued. Otherwise the
            other party has 48 hours to accept or reject. If no response, the
            cancellation is auto-approved.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            variant="danger"
            fullWidth
            size="md"
            onClick={onSubmit}
            loading={actionLoading}
            disabled={cancelRequestReason.trim().length < 10}
          >
            Submit cancellation request
          </Button>
          <Button variant="ghost" fullWidth size="md" onClick={onClose}>
            Keep order
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── Return Request Modal ─────────────────────────────────────────────────────
export function ReturnModal({
  returnType,
  onSetReturnType,
  returnResolution,
  onSetReturnResolution,
  returnReason,
  onSetReturnReason,
  onSubmit,
  onClose,
  actionLoading,
}: {
  returnType: string;
  onSetReturnType: (v: string) => void;
  returnResolution: string;
  onSetReturnResolution: (v: string) => void;
  returnReason: string;
  onSetReturnReason: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  actionLoading: boolean;
}) {
  return (
    <ModalOverlay onClose={onClose} labelledById="return-modal-title">
      <h2
        id="return-modal-title"
        className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4"
      >
        Request a return
      </h2>
      <div className="space-y-4">
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            Return reason
          </label>
          <select
            value={returnType}
            onChange={(e) => onSetReturnType(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]"
          >
            <option value="damaged">Item damaged</option>
            <option value="not_as_described">Not as described</option>
            <option value="wrong_item">Wrong item sent</option>
            <option value="changed_mind">Changed my mind</option>
          </select>
        </div>
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            Preferred resolution
          </label>
          <select
            value={returnResolution}
            onChange={(e) => onSetReturnResolution(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]"
          >
            <option value="full_refund">Full refund</option>
            <option value="replacement">Replacement</option>
            <option value="exchange">Exchange</option>
          </select>
        </div>
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            Details
          </label>
          <textarea
            value={returnReason}
            onChange={(e) => onSetReturnReason(e.target.value)}
            placeholder="Describe the issue in detail (min 10 characters)..."
            rows={4}
            maxLength={500}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
          />
          <p className="text-[11px] text-[#9E9A91] mt-1">
            {returnReason.length}/500 characters
          </p>
        </div>
        <Alert variant="info">
          The seller has 72 hours to respond. If they don&apos;t respond, this
          will automatically escalate to a dispute.
        </Alert>
        <Button
          variant="gold"
          fullWidth
          size="md"
          onClick={onSubmit}
          loading={actionLoading}
          disabled={returnReason.trim().length < 10}
        >
          Submit return request
        </Button>
      </div>
    </ModalOverlay>
  );
}

// ── Partial Refund Modal ─────────────────────────────────────────────────────
export function PartialRefundModal({
  order,
  partialRefundReason,
  onSetPartialRefundReason,
  partialRefundAmount,
  onSetPartialRefundAmount,
  onSubmit,
  onClose,
  actionLoading,
}: {
  order: OrderDetailData;
  partialRefundReason: string;
  onSetPartialRefundReason: (v: string) => void;
  partialRefundAmount: string;
  onSetPartialRefundAmount: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  actionLoading: boolean;
}) {
  return (
    <ModalOverlay onClose={onClose} labelledById="partial-refund-modal-title">
      <h2
        id="partial-refund-modal-title"
        className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4"
      >
        {order.isBuyer ? "Request partial refund" : "Offer partial refund"}
      </h2>
      <div className="space-y-4">
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            Amount (NZD)
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-[#9E9A91] font-medium">
              $
            </span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={(order.total / 100).toFixed(2)}
              value={partialRefundAmount}
              onChange={(e) => onSetPartialRefundAmount(e.target.value)}
              placeholder="0.00"
              className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]"
            />
          </div>
          <p className="text-[11px] text-[#9E9A91] mt-1">
            Maximum: ${(order.total / 100).toFixed(2)} NZD
          </p>
        </div>
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            Reason
          </label>
          <textarea
            value={partialRefundReason}
            onChange={(e) => onSetPartialRefundReason(e.target.value)}
            placeholder="Explain why a partial refund is appropriate (min 10 characters)..."
            rows={4}
            maxLength={500}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
          />
          <p className="text-[11px] text-[#9E9A91] mt-1">
            {partialRefundReason.length}/500 characters
          </p>
        </div>
        <Alert variant="info">
          The other party has 48 hours to accept, reject, or counter-offer.
          Accepted partial refunds will be processed by the{" "}
          {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} team.
        </Alert>
        <Button
          variant="gold"
          fullWidth
          size="md"
          onClick={onSubmit}
          loading={actionLoading}
          disabled={
            partialRefundReason.trim().length < 10 ||
            !partialRefundAmount ||
            parseFloat(partialRefundAmount) <= 0
          }
        >
          Submit request
        </Button>
      </div>
    </ModalOverlay>
  );
}

// ── Shipping Delay Modal ─────────────────────────────────────────────────────
export function ShippingDelayModal({
  delayReason,
  onSetDelayReason,
  newEstimatedDate,
  onSetNewEstimatedDate,
  onSubmit,
  onClose,
  actionLoading,
}: {
  delayReason: string;
  onSetDelayReason: (v: string) => void;
  newEstimatedDate: string;
  onSetNewEstimatedDate: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  actionLoading: boolean;
}) {
  return (
    <ModalOverlay onClose={onClose} labelledById="shipping-delay-modal-title">
      <h2
        id="shipping-delay-modal-title"
        className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4"
      >
        Notify shipping delay
      </h2>
      <div className="space-y-4">
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            Reason for delay
          </label>
          <textarea
            value={delayReason}
            onChange={(e) => onSetDelayReason(e.target.value)}
            placeholder="Explain the reason for the delay (min 10 characters)..."
            rows={4}
            maxLength={500}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
          />
          <p className="text-[11px] text-[#9E9A91] mt-1">
            {delayReason.length}/500 characters
          </p>
        </div>
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            New estimated dispatch date (optional)
          </label>
          <input
            type="date"
            value={newEstimatedDate}
            onChange={(e) => onSetNewEstimatedDate(e.target.value)}
            min={new Date().toISOString().split("T")[0]}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]"
          />
        </div>
        <Alert variant="info">
          The buyer will be notified of the delay. They can acknowledge it or
          request a cancellation if preferred. If no response in 7 days, it
          auto-resolves.
        </Alert>
        <Button
          variant="gold"
          fullWidth
          size="md"
          onClick={onSubmit}
          loading={actionLoading}
          disabled={delayReason.trim().length < 10}
        >
          Send notification
        </Button>
      </div>
    </ModalOverlay>
  );
}

// ── Dispute Modal ────────────────────────────────────────────────────────────
export function DisputeModal({
  disputeReason,
  onSetDisputeReason,
  disputeDescription,
  onSetDisputeDescription,
  disputePhotos,
  onSetDisputePhotos,
  onSubmit,
  onClose,
  actionLoading,
}: {
  disputeReason: string;
  onSetDisputeReason: (v: string) => void;
  disputeDescription: string;
  onSetDisputeDescription: (v: string) => void;
  disputePhotos: File[];
  onSetDisputePhotos: (files: File[]) => void;
  onSubmit: () => void;
  onClose: () => void;
  actionLoading: boolean;
}) {
  return (
    <ModalOverlay onClose={onClose} labelledById="dispute-modal-title">
      <h2
        id="dispute-modal-title"
        className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4"
      >
        Open a dispute
      </h2>
      <div className="space-y-4">
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            Reason
          </label>
          <select
            value={disputeReason}
            onChange={(e) => onSetDisputeReason(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
          >
            <option value="">Select a reason</option>
            <option value="ITEM_NOT_RECEIVED">Item not received</option>
            <option value="ITEM_NOT_AS_DESCRIBED">Item not as described</option>
            <option value="ITEM_DAMAGED">Item damaged in transit</option>
            <option value="WRONG_ITEM_SENT">Wrong item sent</option>
            <option value="COUNTERFEIT_ITEM">Suspected counterfeit</option>
            <option value="SELLER_UNRESPONSIVE">Seller unresponsive</option>
            <option value="SELLER_CANCELLED">
              Seller cancelled after payment
            </option>
            <option value="REFUND_NOT_PROCESSED">Refund not processed</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            Describe the issue
          </label>
          <textarea
            value={disputeDescription}
            onChange={(e) => onSetDisputeDescription(e.target.value)}
            placeholder="Please describe what happened (min 20 characters)..."
            rows={4}
            maxLength={2000}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
          />
          <p className="text-[11px] text-[#9E9A91] mt-1">
            {disputeDescription.length}/2000 characters
          </p>
        </div>
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
            Photos{" "}
            <span className="text-[#9E9A91] font-normal">
              (optional, up to 3)
            </span>
          </label>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-[#C9C5BC] bg-[#FAFAF8] text-[12.5px] text-[#73706A] cursor-pointer hover:border-[#D4A843] hover:bg-[#F5ECD4]/20 transition-colors">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              Add photos
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []).slice(0, 3);
                  onSetDisputePhotos(files);
                }}
              />
            </label>
            {disputePhotos.length > 0 ? (
              <span className="text-[11px] text-emerald-600 font-medium">
                {disputePhotos.length} photo
                {disputePhotos.length !== 1 ? "s" : ""} selected
              </span>
            ) : (
              <span className="text-[11px] text-[#9E9A91]">
                JPG, PNG, WebP up to 5MB each
              </span>
            )}
          </div>
        </div>
        <Alert variant="info">
          Our team will review your dispute within 48 hours. The seller will be
          notified and given an opportunity to respond.
        </Alert>
        <Button
          variant="danger"
          fullWidth
          size="md"
          onClick={onSubmit}
          loading={actionLoading}
        >
          Submit dispute
        </Button>
      </div>
    </ModalOverlay>
  );
}

// ── ProblemResolver Modal ────────────────────────────────────────────────────
export function ProblemResolverModal({
  order,
  orderId,
  onClose,
  onSuccess,
}: {
  order: OrderDetailData;
  orderId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  return (
    <ModalOverlay onClose={onClose} labelledById="problem-resolver-modal-title">
      <ProblemResolver
        orderId={orderId}
        status={order.status}
        listingTitle={order.listingTitle}
        sellerName={order.otherPartyName}
        totalNzd={order.total}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </ModalOverlay>
  );
}
