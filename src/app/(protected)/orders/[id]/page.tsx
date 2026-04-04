"use client";
// src/app/(protected)/orders/[id]/page.tsx
// ─── Order Detail Page — thin orchestration shell ──────────────────────────

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/primitives";
import OrderTimelineComponent from "@/components/OrderTimeline";
import type { TimelineEvent } from "@/components/OrderTimeline";

import {
  confirmDelivery,
  markDispatched,
  uploadOrderEvidence,
} from "@/server/actions/orders";
import {
  openDispute,
  uploadDisputeEvidence,
  respondToDispute,
} from "@/server/actions/disputes";
import { fetchOrderDetail } from "@/server/actions/orderDetail";
import { getOrderTimeline } from "@/server/actions/orderEvents";
import {
  requestCancellation,
  respondToCancellation,
  requestReturn,
  respondToReturn,
  requestPartialRefund,
  respondToPartialRefund,
  notifyShippingDelay,
  respondToShippingDelay,
  getOrderInteractions,
} from "@/server/actions/interactions";
import type { InteractionData } from "@/server/actions/interactions";
import { submitCounterEvidence } from "@/server/actions/counterEvidence";

import type { OrderDetailData } from "./components/order-types";
import { buildSyntheticEvents } from "./components/order-utils";
import OrderHeader from "./components/OrderHeader";
import OrderStatusCard from "./components/OrderStatusCard";
import OrderDisputePanel from "./components/OrderDisputePanel";
import OrderInteractions from "./components/OrderInteractions";
import OrderPaymentDetails from "./components/OrderPaymentDetails";
import OrderActions from "./components/OrderActions";
import OrderDispatchModal from "./components/OrderDispatchModal";
import OrderConfirmDeliveryModal from "./components/OrderConfirmDeliveryModal";
import {
  CancellationModal,
  ReturnModal,
  PartialRefundModal,
  ShippingDelayModal,
  DisputeModal,
  ProblemResolverModal,
} from "./components/OrderFormModals";

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;

  // ── Core state ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetailData | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [interactions, setInteractions] = useState<InteractionData[]>([]);

  // ── Modal visibility ────────────────────────────────────────────────────
  const [showDispatch, setShowDispatch] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [showCancelRequest, setShowCancelRequest] = useState(false);
  const [showReturnRequest, setShowReturnRequest] = useState(false);
  const [showPartialRefund, setShowPartialRefund] = useState(false);
  const [showShippingDelay, setShowShippingDelay] = useState(false);
  const [showProblemResolver, setShowProblemResolver] = useState(false);
  const [showSellerResponse, setShowSellerResponse] = useState(false);
  const [showCounterEvidence, setShowCounterEvidence] = useState(false);

  // ── Dispatch wizard state ───────────────────────────────────────────────
  const [dispatchStep, setDispatchStep] = useState(1);
  const [courierService, setCourierService] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState("");
  const [dispatchPhotos, setDispatchPhotos] = useState<File[]>([]);
  const [dispatchPhotoKeys, setDispatchPhotoKeys] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState(false);

  // ── Confirm delivery state ──────────────────────────────────────────────
  const [itemAsDescribed, setItemAsDescribed] = useState<"yes" | "no" | null>(
    null,
  );
  const [deliveryIssueType, setDeliveryIssueType] = useState("");
  const [deliveryPhotos, setDeliveryPhotos] = useState<File[]>([]);
  const [deliveryPhotoKeys, setDeliveryPhotoKeys] = useState<string[]>([]);
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [uploadingDeliveryPhotos, setUploadingDeliveryPhotos] = useState(false);

  // ── Dispute / seller response state ─────────────────────────────────────
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [disputePhotos, setDisputePhotos] = useState<File[]>([]);
  const [sellerResponseText, setSellerResponseText] = useState("");

  // ── Interaction form state ──────────────────────────────────────────────
  const [cancelRequestReason, setCancelRequestReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnType, setReturnType] = useState("damaged");
  const [returnResolution, setReturnResolution] = useState("full_refund");
  const [partialRefundReason, setPartialRefundReason] = useState("");
  const [partialRefundAmount, setPartialRefundAmount] = useState("");
  const [delayReason, setDelayReason] = useState("");
  const [newEstimatedDate, setNewEstimatedDate] = useState("");

  // ── Counter-evidence state ──────────────────────────────────────────────
  const [counterDescription, setCounterDescription] = useState("");
  const [counterPhotos, setCounterPhotos] = useState<File[]>([]);
  const [counterPhotoKeys, setCounterPhotoKeys] = useState<string[]>([]);
  const [uploadingCounter, setUploadingCounter] = useState(false);
  const [submittingCounter, setSubmittingCounter] = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const result = await fetchOrderDetail(orderId);
        if (result.success) {
          setOrder(result.data);
          const tlResult = await getOrderTimeline(orderId);
          if (tlResult.success && tlResult.data.length > 0) {
            setTimelineEvents(tlResult.data);
          } else {
            setTimelineEvents(buildSyntheticEvents(result.data));
          }
          const intResult = await getOrderInteractions(orderId);
          if (intResult.success) setInteractions(intResult.data);
        } else {
          setError(result.error);
        }
      } catch {
        setError(
          "We couldn't load this order. Please check your connection and refresh the page.",
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [orderId]);

  // ── Refresh helper ──────────────────────────────────────────────────────
  async function refreshOrderData() {
    const updated = await fetchOrderDetail(orderId);
    if (updated.success) setOrder(updated.data);
    const tlResult = await getOrderTimeline(orderId);
    if (tlResult.success) setTimelineEvents(tlResult.data);
    const intResult = await getOrderInteractions(orderId);
    if (intResult.success) setInteractions(intResult.data);
  }

  // ── Handlers ────────────────────────────────────────────────────────────
  async function handleUploadDispatchPhotos(files: File[]) {
    if (files.length === 0) return;
    setUploadingPhotos(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const result = await uploadOrderEvidence(fd, "dispatch");
      if (result.success) {
        setDispatchPhotoKeys((prev) => [...prev, ...result.data.keys]);
        setDispatchPhotos((prev) => [...prev, ...files]);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Failed to upload photos.");
    }
    setUploadingPhotos(false);
  }

  async function handleDispatch() {
    if (!courierService) {
      setError("Please select a courier service.");
      return;
    }
    if (!trackingNumber) {
      setError("Please enter a tracking number.");
      return;
    }
    if (!estimatedDeliveryDate) {
      setError("Please select an estimated delivery date.");
      return;
    }
    if (dispatchPhotoKeys.length === 0) {
      setError("Please upload at least 1 dispatch photo.");
      return;
    }
    setError(null);
    setActionLoading(true);
    const result = await markDispatched({
      orderId,
      trackingNumber,
      courier: courierService,
      trackingUrl: trackingUrl || undefined,
      estimatedDeliveryDate,
      dispatchPhotos: dispatchPhotoKeys,
    });
    if (result.success) {
      setDispatchSuccess(true);
      await refreshOrderData();
    } else {
      setError(result.error);
    }
    setActionLoading(false);
  }

  async function handleUploadDeliveryPhotos(files: File[]) {
    if (files.length === 0) return;
    setUploadingDeliveryPhotos(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const result = await uploadOrderEvidence(fd, "delivery");
      if (result.success) {
        setDeliveryPhotoKeys((prev) => [...prev, ...result.data.keys]);
        setDeliveryPhotos((prev) => [...prev, ...files]);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Failed to upload photos.");
    }
    setUploadingDeliveryPhotos(false);
  }

  async function handleConfirmDelivery() {
    if (itemAsDescribed === null) {
      setError("Please confirm whether the item arrived as described.");
      return;
    }
    if (itemAsDescribed === "no" && !deliveryIssueType) {
      setError("Please select what's wrong with the item.");
      return;
    }
    setError(null);
    setActionLoading(true);
    const result = await confirmDelivery(orderId, {
      itemAsDescribed: itemAsDescribed === "yes",
      issueType: itemAsDescribed === "no" ? deliveryIssueType : undefined,
      deliveryPhotos:
        deliveryPhotoKeys.length > 0 ? deliveryPhotoKeys : undefined,
      notes: deliveryNotes || undefined,
    });
    if (result.success) {
      setActionSuccess(
        itemAsDescribed === "yes"
          ? "Delivery confirmed. Payment released to seller."
          : "Delivery confirmed with issue reported. The seller has been notified.",
      );
      setShowConfirm(false);
      await refreshOrderData();
    } else {
      setError(result.error);
    }
    setActionLoading(false);
  }

  async function handleOpenDispute() {
    if (!disputeReason || disputeDescription.length < 20) {
      setError(
        "Please select a reason and describe the issue (at least 20 characters).",
      );
      return;
    }
    setError(null);
    setActionLoading(true);
    try {
      let evidenceUrls: string[] = [];
      if (disputePhotos.length > 0) {
        const formData = new FormData();
        disputePhotos.forEach((photo) => formData.append("files", photo));
        const uploadResult = await uploadDisputeEvidence(formData);
        if (!uploadResult.success) {
          setError(uploadResult.error);
          setActionLoading(false);
          return;
        }
        evidenceUrls = uploadResult.data?.urls ?? [];
      }
      const result = await openDispute({
        orderId,
        reason: disputeReason,
        description: disputeDescription,
        evidenceUrls,
      });
      if (result.success) {
        setError(null);
        setActionSuccess(
          "Dispute opened. We will review your case within 48 hours.",
        );
        setShowDispute(false);
        await refreshOrderData();
      } else {
        setError(result.error);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSellerResponse() {
    if (sellerResponseText.trim().length < 20) {
      setError("Please provide at least 20 characters in your response.");
      return;
    }
    setError(null);
    setActionLoading(true);
    try {
      const result = await respondToDispute({
        orderId,
        response: sellerResponseText,
      });
      if (result.success) {
        setActionSuccess(
          "Your response has been submitted. The buyer and our team have been notified.",
        );
        setShowSellerResponse(false);
        setSellerResponseText("");
        await refreshOrderData();
      } else {
        setError(result.error);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestCancellation() {
    if (cancelRequestReason.trim().length < 10) {
      setError("Please provide a reason (at least 10 characters).");
      return;
    }
    setError(null);
    setActionLoading(true);
    try {
      const result = await requestCancellation({
        orderId,
        reason: cancelRequestReason.trim(),
      });
      if (result.success) {
        setShowCancelRequest(false);
        setCancelRequestReason("");
        setActionSuccess(
          result.data.autoApproved
            ? "Order cancelled and refund initiated (free cancellation window)."
            : "Cancellation request sent. The other party has 48 hours to respond.",
        );
        await refreshOrderData();
      } else {
        setError(result.error);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRespondToCancellation(
    interactionId: string,
    action: "ACCEPT" | "REJECT",
  ) {
    if (action === "REJECT" && rejectNote.trim().length < 10) {
      setError(
        "Please provide a reason for rejecting (at least 10 characters).",
      );
      return;
    }
    setError(null);
    setActionLoading(true);
    try {
      const result = await respondToCancellation({
        interactionId,
        action,
        responseNote: action === "REJECT" ? rejectNote.trim() : undefined,
      });
      if (result.success) {
        setRejectNote("");
        setActionSuccess(
          action === "ACCEPT"
            ? "Cancellation approved. Refund initiated."
            : "Cancellation rejected.",
        );
        await refreshOrderData();
      } else {
        setError(result.error);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRespondToInteraction(
    interactionId: string,
    type: string,
    action: "ACCEPT" | "REJECT",
    note?: string,
  ) {
    if (action === "REJECT" && (!note || note.trim().length < 10)) {
      setError(
        "Please provide a reason for rejecting (at least 10 characters).",
      );
      return;
    }
    setError(null);
    setActionLoading(true);
    try {
      let result: { success: boolean; error?: string };
      if (type === "RETURN_REQUEST")
        result = await respondToReturn({
          interactionId,
          action,
          responseNote: note,
        });
      else if (type === "PARTIAL_REFUND_REQUEST")
        result = await respondToPartialRefund({
          interactionId,
          action,
          responseNote: note,
        });
      else if (type === "SHIPPING_DELAY")
        result = await respondToShippingDelay({
          interactionId,
          action,
          responseNote: note,
        });
      else
        result = await respondToCancellation({
          interactionId,
          action,
          responseNote: note,
        });
      if (result.success) {
        setRejectNote("");
        setActionSuccess(
          action === "ACCEPT" ? "Request accepted." : "Request rejected.",
        );
        await refreshOrderData();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestReturn() {
    if (returnReason.trim().length < 10) {
      setError("Please provide a reason (at least 10 characters).");
      return;
    }
    setError(null);
    setActionLoading(true);
    try {
      const result = await requestReturn({
        orderId,
        reason: returnReason.trim(),
        details: {
          returnReason: returnType as
            | "damaged"
            | "not_as_described"
            | "wrong_item"
            | "changed_mind",
          preferredResolution: returnResolution as
            | "full_refund"
            | "replacement"
            | "exchange",
        },
      });
      if (result.success) {
        setShowReturnRequest(false);
        setReturnReason("");
        setActionSuccess(
          "Return request sent. The seller has 72 hours to respond.",
        );
        await refreshOrderData();
      } else setError(result.error);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestPartialRefund() {
    if (partialRefundReason.trim().length < 10) {
      setError("Please provide a reason (at least 10 characters).");
      return;
    }
    const amount = parseFloat(partialRefundAmount);
    if (!amount || amount <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    setError(null);
    setActionLoading(true);
    try {
      const result = await requestPartialRefund({
        orderId,
        reason: partialRefundReason.trim(),
        amount,
      });
      if (result.success) {
        setShowPartialRefund(false);
        setPartialRefundReason("");
        setPartialRefundAmount("");
        setActionSuccess(
          "Partial refund request sent. The other party has 48 hours to respond.",
        );
        await refreshOrderData();
      } else setError(result.error);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleNotifyShippingDelay() {
    if (delayReason.trim().length < 10) {
      setError("Please provide a reason (at least 10 characters).");
      return;
    }
    setError(null);
    setActionLoading(true);
    try {
      const result = await notifyShippingDelay({
        orderId,
        reason: delayReason.trim(),
        estimatedNewDate: newEstimatedDate || undefined,
      });
      if (result.success) {
        setShowShippingDelay(false);
        setDelayReason("");
        setNewEstimatedDate("");
        setActionSuccess("Shipping delay notification sent to the buyer.");
        await refreshOrderData();
      } else setError(result.error);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUploadCounterPhotos(files: File[]) {
    if (files.length === 0) return;
    setUploadingCounter(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const res = await uploadOrderEvidence(fd, "delivery");
      if (res.success) {
        setCounterPhotoKeys((prev) => [...prev, ...res.data.keys]);
        setCounterPhotos((prev) => [...prev, ...files]);
      } else setError(res.error);
    } catch {
      setError("Failed to upload photos.");
    }
    setUploadingCounter(false);
  }

  async function handleSubmitCounterEvidence() {
    if (counterDescription.length < 10) {
      setError("Please describe your evidence (at least 10 characters).");
      return;
    }
    setError(null);
    setSubmittingCounter(true);
    const res = await submitCounterEvidence({
      orderId,
      description: counterDescription,
      evidenceKeys: counterPhotoKeys.length > 0 ? counterPhotoKeys : undefined,
    });
    if (res.success) {
      setActionSuccess(
        "Counter-evidence submitted. The case will be re-evaluated.",
      );
      setShowCounterEvidence(false);
      setCounterDescription("");
      setCounterPhotos([]);
      setCounterPhotoKeys([]);
      await refreshOrderData();
    } else setError(res.error);
    setSubmittingCounter(false);
  }

  // ── Computed values ─────────────────────────────────────────────────────
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

  // ── Loading / error states ──────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            <div className="animate-pulse space-y-4">
              <div className="bg-white rounded-2xl border border-[#E3E0D9] h-48" />
              <div className="bg-white rounded-2xl border border-[#E3E0D9] h-64" />
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (error && !order) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <p className="text-[14px] text-[#9E9A91]">{error}</p>
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

  if (!order) return null;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <OrderHeader
            order={order}
            actionSuccess={actionSuccess}
            error={error}
          />
          <OrderStatusCard order={order} timelineEvents={timelineEvents} />
          <OrderTimelineComponent
            events={timelineEvents}
            currentStatus={order.status}
          />
          <OrderDisputePanel
            order={order}
            timelineEvents={timelineEvents}
            showCounterEvidence={showCounterEvidence}
            onSetShowCounterEvidence={setShowCounterEvidence}
            counterDescription={counterDescription}
            onSetCounterDescription={setCounterDescription}
            counterPhotos={counterPhotos}
            counterPhotoKeys={counterPhotoKeys}
            uploadingCounter={uploadingCounter}
            submittingCounter={submittingCounter}
            onUploadCounterPhotos={handleUploadCounterPhotos}
            onRemoveCounterPhoto={(i) => {
              setCounterPhotos((p) => p.filter((_, idx) => idx !== i));
              setCounterPhotoKeys((k) => k.filter((_, idx) => idx !== i));
            }}
            onSubmitCounterEvidence={handleSubmitCounterEvidence}
            showSellerResponse={showSellerResponse}
            onSetShowSellerResponse={setShowSellerResponse}
            sellerResponseText={sellerResponseText}
            onSetSellerResponseText={setSellerResponseText}
            onSubmitSellerResponse={handleSellerResponse}
            actionLoading={actionLoading}
          />
          <OrderInteractions
            order={order}
            pendingCancelRequest={pendingCancelRequest}
            pendingReturnRequest={pendingReturnRequest}
            pendingPartialRefund={pendingPartialRefund}
            pendingShippingDelay={pendingShippingDelay}
            rejectNote={rejectNote}
            onSetRejectNote={setRejectNote}
            onRespondToCancellation={handleRespondToCancellation}
            onRespondToInteraction={handleRespondToInteraction}
            actionLoading={actionLoading}
          />
          <OrderPaymentDetails order={order} />
          <OrderActions
            order={order}
            pendingCancelRequest={pendingCancelRequest}
            pendingReturnRequest={pendingReturnRequest}
            pendingPartialRefund={pendingPartialRefund}
            pendingShippingDelay={pendingShippingDelay}
            onShowDispatch={() => setShowDispatch(true)}
            onShowConfirm={() => setShowConfirm(true)}
            onShowDispute={() => setShowDispute(true)}
            onShowCancelRequest={() => setShowCancelRequest(true)}
            onShowReturnRequest={() => setShowReturnRequest(true)}
            onShowPartialRefund={() => setShowPartialRefund(true)}
            onShowShippingDelay={() => setShowShippingDelay(true)}
            onShowProblemResolver={() => setShowProblemResolver(true)}
          />
        </div>
      </main>
      <Footer />

      {/* ── Modals ──────────────────────────────────────────────────── */}
      {showDispatch && (
        <OrderDispatchModal
          order={order}
          dispatchStep={dispatchStep}
          onSetDispatchStep={setDispatchStep}
          courierService={courierService}
          onSetCourierService={setCourierService}
          trackingNumber={trackingNumber}
          onSetTrackingNumber={setTrackingNumber}
          trackingUrl={trackingUrl}
          onSetTrackingUrl={setTrackingUrl}
          estimatedDeliveryDate={estimatedDeliveryDate}
          onSetEstimatedDeliveryDate={setEstimatedDeliveryDate}
          dispatchPhotos={dispatchPhotos}
          dispatchPhotoKeys={dispatchPhotoKeys}
          uploadingPhotos={uploadingPhotos}
          dispatchSuccess={dispatchSuccess}
          onUploadDispatchPhotos={handleUploadDispatchPhotos}
          onRemoveDispatchPhoto={(i) => {
            setDispatchPhotos((p) => p.filter((_, idx) => idx !== i));
            setDispatchPhotoKeys((k) => k.filter((_, idx) => idx !== i));
          }}
          onDispatch={handleDispatch}
          onClose={() => {
            setShowDispatch(false);
            setDispatchStep(1);
            setDispatchSuccess(false);
          }}
          actionLoading={actionLoading}
        />
      )}
      {showConfirm && (
        <OrderConfirmDeliveryModal
          order={order}
          itemAsDescribed={itemAsDescribed}
          onSetItemAsDescribed={setItemAsDescribed}
          deliveryIssueType={deliveryIssueType}
          onSetDeliveryIssueType={setDeliveryIssueType}
          deliveryPhotos={deliveryPhotos}
          deliveryPhotoKeys={deliveryPhotoKeys}
          uploadingDeliveryPhotos={uploadingDeliveryPhotos}
          deliveryNotes={deliveryNotes}
          onSetDeliveryNotes={setDeliveryNotes}
          onUploadDeliveryPhotos={handleUploadDeliveryPhotos}
          onRemoveDeliveryPhoto={(i) => {
            setDeliveryPhotos((p) => p.filter((_, idx) => idx !== i));
            setDeliveryPhotoKeys((k) => k.filter((_, idx) => idx !== i));
          }}
          onConfirmDelivery={handleConfirmDelivery}
          onClose={() => setShowConfirm(false)}
          onOpenDispute={() => {
            setShowConfirm(false);
            setShowDispute(true);
          }}
          actionLoading={actionLoading}
        />
      )}
      {showCancelRequest && (
        <CancellationModal
          cancelRequestReason={cancelRequestReason}
          onSetCancelRequestReason={setCancelRequestReason}
          onSubmit={handleRequestCancellation}
          onClose={() => {
            setShowCancelRequest(false);
            setCancelRequestReason("");
          }}
          actionLoading={actionLoading}
        />
      )}
      {showReturnRequest && (
        <ReturnModal
          returnType={returnType}
          onSetReturnType={setReturnType}
          returnResolution={returnResolution}
          onSetReturnResolution={setReturnResolution}
          returnReason={returnReason}
          onSetReturnReason={setReturnReason}
          onSubmit={handleRequestReturn}
          onClose={() => setShowReturnRequest(false)}
          actionLoading={actionLoading}
        />
      )}
      {showPartialRefund && (
        <PartialRefundModal
          order={order}
          partialRefundReason={partialRefundReason}
          onSetPartialRefundReason={setPartialRefundReason}
          partialRefundAmount={partialRefundAmount}
          onSetPartialRefundAmount={setPartialRefundAmount}
          onSubmit={handleRequestPartialRefund}
          onClose={() => setShowPartialRefund(false)}
          actionLoading={actionLoading}
        />
      )}
      {showShippingDelay && (
        <ShippingDelayModal
          delayReason={delayReason}
          onSetDelayReason={setDelayReason}
          newEstimatedDate={newEstimatedDate}
          onSetNewEstimatedDate={setNewEstimatedDate}
          onSubmit={handleNotifyShippingDelay}
          onClose={() => setShowShippingDelay(false)}
          actionLoading={actionLoading}
        />
      )}
      {showDispute && (
        <DisputeModal
          disputeReason={disputeReason}
          onSetDisputeReason={setDisputeReason}
          disputeDescription={disputeDescription}
          onSetDisputeDescription={setDisputeDescription}
          disputePhotos={disputePhotos}
          onSetDisputePhotos={setDisputePhotos}
          onSubmit={handleOpenDispute}
          onClose={() => setShowDispute(false)}
          actionLoading={actionLoading}
        />
      )}
      {showProblemResolver && (
        <ProblemResolverModal
          order={order}
          orderId={orderId}
          onClose={() => setShowProblemResolver(false)}
          onSuccess={refreshOrderData}
        />
      )}
    </>
  );
}
