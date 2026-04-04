"use client";

import { Button } from "@/components/ui/primitives";
import type { OrderDetailData, InteractionData } from "./order-types";

function AmberIcon() {
  return (
    <div className="shrink-0 w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center mt-0.5">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#D97706"
        strokeWidth="2.5"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    </div>
  );
}

function RejectForm({
  rejectNote,
  onSetRejectNote,
  actionLoading,
  onSubmit,
}: {
  rejectNote: string;
  onSetRejectNote: (v: string) => void;
  actionLoading: boolean;
  onSubmit: () => void;
}) {
  if (rejectNote === "") return null;
  return (
    <div>
      <textarea
        value={rejectNote}
        onChange={(e) => onSetRejectNote(e.target.value)}
        placeholder="Explain why you're rejecting (min 10 characters)..."
        rows={3}
        maxLength={500}
        className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
      />
      <Button
        variant="secondary"
        size="sm"
        loading={actionLoading}
        disabled={rejectNote.trim().length < 10}
        onClick={onSubmit}
        className="mt-2"
      >
        Submit rejection
      </Button>
    </div>
  );
}

export default function OrderInteractions({
  order,
  pendingCancelRequest,
  pendingReturnRequest,
  pendingPartialRefund,
  pendingShippingDelay,
  rejectNote,
  onSetRejectNote,
  onRespondToCancellation,
  onRespondToInteraction,
  actionLoading,
}: {
  order: OrderDetailData;
  pendingCancelRequest: InteractionData | undefined;
  pendingReturnRequest: InteractionData | undefined;
  pendingPartialRefund: InteractionData | undefined;
  pendingShippingDelay: InteractionData | undefined;
  rejectNote: string;
  onSetRejectNote: (v: string) => void;
  onRespondToCancellation: (
    interactionId: string,
    action: "ACCEPT" | "REJECT",
  ) => void;
  onRespondToInteraction: (
    interactionId: string,
    type: string,
    action: "ACCEPT" | "REJECT",
    note?: string,
  ) => void;
  actionLoading: boolean;
}) {
  const currentUserId = order.isBuyer ? order.buyerId : order.sellerId;

  return (
    <>
      {pendingCancelRequest && (
        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5 mb-6">
          <div className="flex items-start gap-3">
            <AmberIcon />
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-amber-900">
                Cancellation requested
              </p>
              <p className="text-[12.5px] text-amber-800 mt-1">
                {pendingCancelRequest.initiatorRole === "BUYER"
                  ? "The buyer"
                  : "The seller"}{" "}
                has requested to cancel this order.
              </p>
              <p className="text-[12px] text-amber-700 mt-1 italic">
                &ldquo;{pendingCancelRequest.reason}&rdquo;
              </p>
              <p className="text-[11px] text-amber-600 mt-2">
                Expires{" "}
                {new Date(pendingCancelRequest.expiresAt).toLocaleDateString(
                  "en-NZ",
                  {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  },
                )}{" "}
                — auto-approves if no response
              </p>
              {pendingCancelRequest.initiator.id !== currentUserId && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      loading={actionLoading}
                      onClick={() =>
                        onRespondToCancellation(
                          pendingCancelRequest.id,
                          "ACCEPT",
                        )
                      }
                    >
                      Accept cancellation
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onSetRejectNote(rejectNote ? "" : " ")}
                    >
                      Reject
                    </Button>
                  </div>
                  <RejectForm
                    rejectNote={rejectNote}
                    onSetRejectNote={onSetRejectNote}
                    actionLoading={actionLoading}
                    onSubmit={() =>
                      onRespondToCancellation(pendingCancelRequest.id, "REJECT")
                    }
                  />
                </div>
              )}
              {pendingCancelRequest.initiator.id === currentUserId && (
                <p className="mt-3 text-[12px] text-amber-700 font-medium">
                  Waiting for the other party to respond...
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {[pendingReturnRequest, pendingPartialRefund, pendingShippingDelay]
        .filter(Boolean)
        .map((interaction) => {
          const ix = interaction!;
          const isInitiator = ix.initiator.id === currentUserId;
          const typeLabels: Record<string, string> = {
            RETURN_REQUEST: "Return requested",
            PARTIAL_REFUND_REQUEST: "Partial refund requested",
            SHIPPING_DELAY: "Shipping delay",
          };
          const details = ix.details ?? {};
          return (
            <div
              key={ix.id}
              className="bg-amber-50 rounded-2xl border border-amber-200 p-5 mb-6"
            >
              <div className="flex items-start gap-3">
                <AmberIcon />
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-amber-900">
                    {typeLabels[ix.type] ?? ix.type.replace(/_/g, " ")}
                    {ix.status === "COUNTERED" && " — counter-offer"}
                  </p>
                  <p className="text-[12.5px] text-amber-800 mt-1">
                    {ix.initiatorRole === "BUYER" ? "The buyer" : "The seller"}{" "}
                    {ix.type === "SHIPPING_DELAY"
                      ? "notified a shipping delay."
                      : "made this request."}
                  </p>
                  <p className="text-[12px] text-amber-700 mt-1 italic">
                    &ldquo;{ix.reason}&rdquo;
                  </p>
                  {!!details.requestedAmount && (
                    <p className="text-[12px] text-amber-800 mt-1 font-medium">
                      Amount: $
                      {(Number(details.requestedAmount) / 100).toFixed(2)} NZD
                    </p>
                  )}
                  {ix.status === "COUNTERED" && !!details.counterAmount && (
                    <p className="text-[12px] text-amber-900 mt-1 font-semibold">
                      Counter-offer: $
                      {(Number(details.counterAmount) / 100).toFixed(2)} NZD
                    </p>
                  )}
                  {!!details.returnReason && (
                    <p className="text-[12px] text-amber-700 mt-1">
                      Type: {String(details.returnReason).replace(/_/g, " ")}
                    </p>
                  )}
                  {!!details.newEstimatedDate && (
                    <p className="text-[12px] text-amber-700 mt-1">
                      New estimate: {String(details.newEstimatedDate)}
                    </p>
                  )}
                  <p className="text-[11px] text-amber-600 mt-2">
                    Expires{" "}
                    {new Date(ix.expiresAt).toLocaleDateString("en-NZ", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                  {!isInitiator && ix.status === "PENDING" && (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="gold"
                          size="sm"
                          loading={actionLoading}
                          onClick={() =>
                            onRespondToInteraction(ix.id, ix.type, "ACCEPT")
                          }
                        >
                          Accept
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onSetRejectNote(rejectNote ? "" : " ")}
                        >
                          Reject
                        </Button>
                      </div>
                      <RejectForm
                        rejectNote={rejectNote}
                        onSetRejectNote={onSetRejectNote}
                        actionLoading={actionLoading}
                        onSubmit={() =>
                          onRespondToInteraction(
                            ix.id,
                            ix.type,
                            "REJECT",
                            rejectNote.trim(),
                          )
                        }
                      />
                    </div>
                  )}
                  {isInitiator && ix.status === "COUNTERED" && (
                    <div className="mt-4 flex items-center gap-2">
                      <Button
                        variant="gold"
                        size="sm"
                        loading={actionLoading}
                        onClick={() =>
                          onRespondToInteraction(ix.id, ix.type, "ACCEPT")
                        }
                      >
                        Accept counter-offer
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={actionLoading}
                        onClick={() =>
                          onRespondToInteraction(
                            ix.id,
                            ix.type,
                            "REJECT",
                            "Counter-offer rejected",
                          )
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                  {isInitiator && ix.status === "PENDING" && (
                    <p className="mt-3 text-[12px] text-amber-700 font-medium">
                      Waiting for the other party to respond...
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
    </>
  );
}
