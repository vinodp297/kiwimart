"use client";
// src/app/(protected)/orders/[id]/components/OrderPageClient.tsx
// ─── Client orchestrator — receives initial data from server component ────────
//
// useState budget: order (1), timelineEvents (2), interactions (3).
// All action state lives in useOrderActions.

import { useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/primitives";
import OrderTimelineComponent from "@/components/OrderTimeline";
import type { TimelineEvent } from "@/components/OrderTimeline";

import { fetchOrderDetail } from "@/server/actions/orderDetail";
import { getOrderTimeline } from "@/server/actions/orderEvents";
import { getOrderInteractions } from "@/server/actions/interactions";
import type { InteractionData } from "@/server/actions/interactions";

import type { OrderDetailData } from "./order-types";
import { buildSyntheticEvents } from "./order-utils";
import OrderHeader from "./OrderHeader";
import OrderStatusCard from "./OrderStatusCard";
import OrderDisputePanel from "./OrderDisputePanel";
import OrderInteractions from "./OrderInteractions";
import OrderPaymentDetails from "./OrderPaymentDetails";
import OrderActions from "./OrderActions";
import OrderDispatchModal from "./OrderDispatchModal";
import OrderConfirmDeliveryModal from "./OrderConfirmDeliveryModal";
import {
  CancellationModal,
  ReturnModal,
  PartialRefundModal,
  ShippingDelayModal,
  DisputeModal,
  ProblemResolverModal,
} from "./OrderFormModals";
import { useOrderActions } from "../hooks/useOrderActions";
import { CancellationCountdown } from "@/components/orders/CancellationCountdown";
import type { CancellationStatus } from "@/modules/orders/order-cancel.service";

// ── Pickup safety reminder — shown for pickup orders awaiting meetup ──────────
function PickupSafetyReminder() {
  return (
    <div
      className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-6
        flex items-start gap-3"
    >
      <svg
        aria-hidden="true"
        className="shrink-0 mt-0.5 text-amber-600"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      <div>
        <p className="text-[13.5px] font-semibold text-amber-800 mb-0.5">
          Safe pickup tips
        </p>
        <ul className="text-[12px] text-amber-700 space-y-0.5 leading-relaxed list-disc list-inside">
          <li>
            Meet in a busy public place — a mall, library, or police station
          </li>
          <li>Bring a friend and meet during daylight hours</li>
          <li>Inspect the item before completing the transaction</li>
        </ul>
      </div>
    </div>
  );
}

interface Props {
  orderId: string;
  initialOrder: OrderDetailData;
  initialTimeline: TimelineEvent[];
  initialInteractions: InteractionData[];
  initialCancellationStatus?: CancellationStatus | null;
}

export default function OrderPageClient({
  orderId,
  initialOrder,
  initialTimeline,
  initialInteractions,
  initialCancellationStatus,
}: Props) {
  // ── Data state (3 useState — within budget) ──────────────────────────────
  const [order, setOrder] = useState<OrderDetailData>(initialOrder);
  const [timelineEvents, setTimelineEvents] =
    useState<TimelineEvent[]>(initialTimeline);
  const [interactions, setInteractions] =
    useState<InteractionData[]>(initialInteractions);

  // ── Refresh helper passed to useOrderActions ─────────────────────────────
  async function handleRefresh() {
    const [orderResult, tlResult, intResult] = await Promise.all([
      fetchOrderDetail(orderId),
      getOrderTimeline(orderId),
      getOrderInteractions(orderId),
    ]);
    if (orderResult.success) setOrder(orderResult.data);
    if (tlResult.success && tlResult.data.length > 0)
      setTimelineEvents(tlResult.data);
    else if (orderResult.success)
      setTimelineEvents(buildSyntheticEvents(orderResult.data));
    if (intResult.success) setInteractions(intResult.data);
  }

  // ── All action state + handlers ──────────────────────────────────────────
  const actions = useOrderActions(orderId, handleRefresh);

  // ── Derived pending-interaction lookups ──────────────────────────────────
  const pendingCancelRequest = interactions.find(
    (i) => i.type === "CANCEL_REQUEST" && i.status === "PENDING",
  );
  const pendingReturnRequest = interactions.find(
    (i) => i.type === "RETURN_REQUEST" && i.status === "PENDING",
  );
  const pendingPartialRefund = interactions.find(
    (i) =>
      i.type === "PARTIAL_REFUND_REQUEST" &&
      (i.status === "PENDING" || i.status === "COUNTERED"),
  );
  const pendingShippingDelay = interactions.find(
    (i) => i.type === "SHIPPING_DELAY" && i.status === "PENDING",
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <OrderHeader
            order={order}
            actionSuccess={actions.actionSuccess}
            error={actions.error}
          />
          <OrderStatusCard order={order} timelineEvents={timelineEvents} />
          {order.fulfillmentType === "PICKUP" &&
            (order.status === "payment_held" ||
              order.status === "awaiting_pickup") && <PickupSafetyReminder />}
          {initialCancellationStatus &&
            initialCancellationStatus.windowType !== "na" && (
              <div className="mt-3 flex justify-center">
                <CancellationCountdown
                  windowType={initialCancellationStatus.windowType}
                  minutesLeft={initialCancellationStatus.minutesLeft}
                  canCancel={initialCancellationStatus.canCancel}
                />
              </div>
            )}
          <OrderTimelineComponent
            events={timelineEvents}
            currentStatus={order.status}
          />
          <OrderDisputePanel
            order={order}
            timelineEvents={timelineEvents}
            showCounterEvidence={actions.activeModal === "counterEvidence"}
            onSetShowCounterEvidence={(v) =>
              v ? actions.openModal("counterEvidence") : actions.closeModal()
            }
            counterDescription={actions.counterDescription}
            onSetCounterDescription={actions.setCounterDescription}
            counterPhotos={actions.counterPhotos}
            counterPhotoKeys={actions.counterPhotoKeys}
            uploadingCounter={actions.uploadingCounter}
            submittingCounter={actions.submittingCounter}
            onUploadCounterPhotos={actions.handleUploadCounterPhotos}
            onRemoveCounterPhoto={actions.handleRemoveCounterPhoto}
            onSubmitCounterEvidence={actions.handleSubmitCounterEvidence}
            showSellerResponse={actions.activeModal === "sellerResponse"}
            onSetShowSellerResponse={(v) =>
              v ? actions.openModal("sellerResponse") : actions.closeModal()
            }
            sellerResponseText={actions.sellerResponseText}
            onSetSellerResponseText={actions.setSellerResponseText}
            onSubmitSellerResponse={actions.handleSellerResponse}
            actionLoading={actions.actionLoading}
          />
          <OrderInteractions
            order={order}
            pendingCancelRequest={pendingCancelRequest}
            pendingReturnRequest={pendingReturnRequest}
            pendingPartialRefund={pendingPartialRefund}
            pendingShippingDelay={pendingShippingDelay}
            rejectNote={actions.rejectNote}
            onSetRejectNote={actions.setRejectNote}
            onRespondToCancellation={actions.handleRespondToCancellation}
            onRespondToInteraction={actions.handleRespondToInteraction}
            actionLoading={actions.actionLoading}
          />
          <OrderPaymentDetails order={order} />
          <OrderActions
            order={order}
            pendingCancelRequest={pendingCancelRequest}
            pendingReturnRequest={pendingReturnRequest}
            pendingPartialRefund={pendingPartialRefund}
            pendingShippingDelay={pendingShippingDelay}
            onShowDispatch={() => actions.openModal("dispatch")}
            onShowConfirm={() => actions.openModal("confirm")}
            onShowDispute={() => actions.openModal("dispute")}
            onShowCancelRequest={() => actions.openModal("cancelRequest")}
            onShowReturnRequest={() => actions.openModal("returnRequest")}
            onShowPartialRefund={() => actions.openModal("partialRefund")}
            onShowShippingDelay={() => actions.openModal("shippingDelay")}
            onShowProblemResolver={() => actions.openModal("problemResolver")}
          />
        </div>
      </main>
      <Footer />

      {/* ── Modals ──────────────────────────────────────────────── */}
      {actions.activeModal === "dispatch" && (
        <OrderDispatchModal
          order={order}
          dispatchStep={actions.dispatchStep}
          onSetDispatchStep={actions.setDispatchStep}
          courierService={actions.courierService}
          onSetCourierService={actions.setCourierService}
          trackingNumber={actions.trackingNumber}
          onSetTrackingNumber={actions.setTrackingNumber}
          trackingUrl={actions.trackingUrl}
          onSetTrackingUrl={actions.setTrackingUrl}
          estimatedDeliveryDate={actions.estimatedDeliveryDate}
          onSetEstimatedDeliveryDate={actions.setEstimatedDeliveryDate}
          dispatchPhotos={actions.dispatchPhotos}
          dispatchPhotoKeys={actions.dispatchPhotoKeys}
          uploadingPhotos={actions.uploadingPhotos}
          dispatchSuccess={actions.dispatchSuccess}
          onUploadDispatchPhotos={actions.handleUploadDispatchPhotos}
          onRemoveDispatchPhoto={actions.handleRemoveDispatchPhoto}
          onDispatch={actions.handleDispatch}
          onClose={() => {
            actions.closeModal();
            actions.setDispatchStep(1);
          }}
          actionLoading={actions.actionLoading}
        />
      )}
      {actions.activeModal === "confirm" && (
        <OrderConfirmDeliveryModal
          order={order}
          itemAsDescribed={actions.itemAsDescribed}
          onSetItemAsDescribed={actions.setItemAsDescribed}
          deliveryIssueType={actions.deliveryIssueType}
          onSetDeliveryIssueType={actions.setDeliveryIssueType}
          deliveryPhotos={actions.deliveryPhotos}
          deliveryPhotoKeys={actions.deliveryPhotoKeys}
          uploadingDeliveryPhotos={actions.uploadingDeliveryPhotos}
          deliveryNotes={actions.deliveryNotes}
          onSetDeliveryNotes={actions.setDeliveryNotes}
          onUploadDeliveryPhotos={actions.handleUploadDeliveryPhotos}
          onRemoveDeliveryPhoto={actions.handleRemoveDeliveryPhoto}
          onConfirmDelivery={actions.handleConfirmDelivery}
          onClose={() => actions.closeModal()}
          onOpenDispute={() => actions.openModal("dispute")}
          actionLoading={actions.actionLoading}
        />
      )}
      {actions.activeModal === "cancelRequest" && (
        <CancellationModal
          cancelRequestReason={actions.cancelRequestReason}
          onSetCancelRequestReason={actions.setCancelRequestReason}
          onSubmit={actions.handleRequestCancellation}
          onClose={() => {
            actions.closeModal();
            actions.setCancelRequestReason("");
          }}
          actionLoading={actions.actionLoading}
        />
      )}
      {actions.activeModal === "returnRequest" && (
        <ReturnModal
          returnType={actions.returnType}
          onSetReturnType={actions.setReturnType}
          returnResolution={actions.returnResolution}
          onSetReturnResolution={actions.setReturnResolution}
          returnReason={actions.returnReason}
          onSetReturnReason={actions.setReturnReason}
          onSubmit={actions.handleRequestReturn}
          onClose={() => actions.closeModal()}
          actionLoading={actions.actionLoading}
        />
      )}
      {actions.activeModal === "partialRefund" && (
        <PartialRefundModal
          order={order}
          partialRefundReason={actions.partialRefundReason}
          onSetPartialRefundReason={actions.setPartialRefundReason}
          partialRefundAmount={actions.partialRefundAmount}
          onSetPartialRefundAmount={actions.setPartialRefundAmount}
          onSubmit={actions.handleRequestPartialRefund}
          onClose={() => actions.closeModal()}
          actionLoading={actions.actionLoading}
        />
      )}
      {actions.activeModal === "shippingDelay" && (
        <ShippingDelayModal
          delayReason={actions.delayReason}
          onSetDelayReason={actions.setDelayReason}
          newEstimatedDate={actions.newEstimatedDate}
          onSetNewEstimatedDate={actions.setNewEstimatedDate}
          onSubmit={actions.handleNotifyShippingDelay}
          onClose={() => actions.closeModal()}
          actionLoading={actions.actionLoading}
        />
      )}
      {actions.activeModal === "dispute" && (
        <DisputeModal
          disputeReason={actions.disputeReason}
          onSetDisputeReason={actions.setDisputeReason}
          disputeDescription={actions.disputeDescription}
          onSetDisputeDescription={actions.setDisputeDescription}
          disputePhotos={actions.disputePhotos}
          onSetDisputePhotos={actions.setDisputePhotos}
          onSubmit={actions.handleOpenDispute}
          onClose={() => actions.closeModal()}
          actionLoading={actions.actionLoading}
        />
      )}
      {actions.activeModal === "problemResolver" && (
        <ProblemResolverModal
          order={order}
          orderId={orderId}
          onClose={() => actions.closeModal()}
          onSuccess={handleRefresh}
        />
      )}
    </>
  );
}

// ── Error / Not-found shell (rendered server-side when order load fails) ──────

export function OrderErrorShell({ message }: { message: string }) {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-[14px] text-[#9E9A91]">{message}</p>
          <Link href="/dashboard/buyer" className="mt-3 inline-block">
            <Button variant="secondary" size="sm">
              Back to dashboard
            </Button>
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
