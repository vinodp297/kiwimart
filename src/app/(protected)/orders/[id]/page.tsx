"use client";
// src/app/(protected)/orders/[id]/page.tsx
// ─── Order Detail Page ──────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { Button, OrderStatusBadge, Alert } from "@/components/ui/primitives";
import { formatPrice, relativeTime } from "@/lib/utils";
import type { OrderStatus } from "@/types";
import {
  confirmDelivery,
  markDispatched,
  uploadOrderEvidence,
} from "@/server/actions/orders";
import { VALID_COURIERS } from "@/shared/constants";
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
import OrderTimeline from "@/components/OrderTimeline";
import type { TimelineEvent } from "@/components/OrderTimeline";
import {
  getOrderStatusInfo,
  type OrderForStatus,
} from "@/lib/orderStatusMessages";
import ProblemResolver from "@/components/ProblemResolver";
import { submitCounterEvidence } from "@/server/actions/counterEvidence";

// ── Courier URL detection ────────────────────────────────────────────────────
function getCourierUrl(trackingNumber: string): string {
  const tn = trackingNumber.toUpperCase().trim();

  // NZ Post international format (2 letters + 9 digits + 2 letters) or NZ prefix
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tn) || tn.startsWith("NZ")) {
    return `https://www.nzpost.co.nz/tools/tracking?trackid=${encodeURIComponent(tn)}`;
  }
  // CourierPost
  if (tn.startsWith("CP") || tn.startsWith("CPA")) {
    return `https://www.courierpost.co.nz/track/?trackingid=${encodeURIComponent(tn)}`;
  }
  // Aramex (long numeric)
  if (/^\d{10,}$/.test(tn)) {
    return `https://www.aramex.co.nz/tools/track?l=${encodeURIComponent(tn)}`;
  }
  // DHL
  if (tn.startsWith("DHL") || /^\d{10}$/.test(tn)) {
    return `https://www.dhl.com/nz-en/home/tracking/tracking-parcel.html?submit=1&tracking-id=${encodeURIComponent(tn)}`;
  }
  // Default — NZ Post (most common NZ courier)
  return `https://www.nzpost.co.nz/tools/tracking?trackid=${encodeURIComponent(tn)}`;
}

// ── Format a date/time string for timeline display ───────────────────────────
function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleDateString("en-NZ", { month: "short" });
  const year = d.getFullYear();
  const time = d
    .toLocaleTimeString("en-NZ", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
  return `${day} ${month} ${year}, ${time}`;
}

// ── Status info messages (Fix 8) ─────────────────────────────────────────────
function getStatusInfo(order: OrderDetailData): {
  icon: React.ReactNode;
  title: string;
  message: string;
  colour: string;
} | null {
  const isBuyer = order.isBuyer;

  switch (order.status) {
    case "awaiting_payment":
      return {
        icon: <CreditCardIcon />,
        title: "Awaiting payment",
        message:
          "Your payment is being processed. This usually takes a few seconds.",
        colour: "bg-amber-50 border-amber-200 text-amber-800",
      };
    case "payment_held":
      return isBuyer
        ? {
            icon: <ShieldIcon />,
            title: "Payment secured",
            message: `Your payment of ${formatPrice(order.total)} is held safely. It will be released to the seller once you confirm delivery.`,
            colour: "bg-sky-50 border-sky-200 text-sky-800",
          }
        : {
            icon: <PackageIcon />,
            title: "Payment received — time to ship!",
            message: `The buyer has paid ${formatPrice(order.total)}. Please dispatch the item and add a tracking number.`,
            colour: "bg-emerald-50 border-emerald-200 text-emerald-800",
          };
    case "dispatched":
      return isBuyer
        ? {
            icon: <TruckIcon />,
            title: "Item on its way",
            message:
              "The seller has dispatched your item. Please confirm delivery once it arrives.",
            colour: "bg-sky-50 border-sky-200 text-sky-800",
          }
        : {
            icon: <TruckIcon />,
            title: "Item dispatched",
            message:
              "Waiting for the buyer to confirm delivery. Payment will be released once confirmed.",
            colour: "bg-sky-50 border-sky-200 text-sky-800",
          };
    case "delivered":
      return isBuyer
        ? {
            icon: <CheckCircleIcon />,
            title: "Item delivered",
            message:
              "Your item has been marked as delivered. Please confirm receipt to release payment.",
            colour: "bg-emerald-50 border-emerald-200 text-emerald-800",
          }
        : {
            icon: <CheckCircleIcon />,
            title: "Delivered",
            message:
              "The item has been delivered. Waiting for buyer confirmation to release your payment.",
            colour: "bg-emerald-50 border-emerald-200 text-emerald-800",
          };
    case "completed":
      return {
        icon: <CheckCircleIcon />,
        title: "Order complete",
        message: isBuyer
          ? "This order is complete. Payment has been released to the seller."
          : `This order is complete. ${formatPrice(order.total)} has been released to your account.`,
        colour: "bg-emerald-50 border-emerald-200 text-emerald-800",
      };
    case "disputed":
      return {
        icon: <AlertTriangleIcon />,
        title: "Dispute in progress",
        message:
          "Our Trust & Safety team is reviewing this case. We aim to resolve disputes within 48 hours.",
        colour: "bg-red-50 border-red-200 text-red-800",
      };
    case "refunded":
      return {
        icon: <RefundIcon />,
        title: "Refunded",
        message: isBuyer
          ? `A refund of ${formatPrice(order.total)} has been issued to your original payment method.`
          : "This order has been refunded to the buyer.",
        colour: "bg-violet-50 border-violet-200 text-violet-800",
      };
    case "cancelled":
      return {
        icon: <XCircleIcon />,
        title: "Order cancelled",
        message: order.cancelReason
          ? `This order was cancelled. Reason: ${order.cancelReason}`
          : "This order has been cancelled.",
        colour: "bg-neutral-50 border-neutral-200 text-neutral-700",
      };
    default:
      return null;
  }
}

// ── Synthetic events for legacy orders ───────────────────────────────────────
// Orders created before the OrderEvent system have no events in the DB.
// Build a minimal timeline from the order's existing timestamps.

function buildSyntheticEvents(order: OrderDetailData): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let counter = 0;
  const synId = () => `synthetic-${counter++}`;

  // ORDER_CREATED always exists
  events.push({
    id: synId(),
    type: "ORDER_CREATED",
    actorRole: "BUYER",
    summary: "Order placed",
    metadata: null,
    createdAt: order.createdAt,
    actor: null,
  });

  // PAYMENT_HELD — if order moved past AWAITING_PAYMENT
  const pastPayment = [
    "payment_held",
    "dispatched",
    "delivered",
    "completed",
    "disputed",
    "refunded",
  ].includes(order.status);
  if (pastPayment) {
    events.push({
      id: synId(),
      type: "PAYMENT_HELD",
      actorRole: "SYSTEM",
      summary: "Payment authorized and held in escrow",
      metadata: null,
      createdAt: order.createdAt, // best available timestamp
      actor: null,
    });
  }

  // DISPATCHED
  if (order.dispatchedAt) {
    events.push({
      id: synId(),
      type: "DISPATCHED",
      actorRole: "SELLER",
      summary: order.trackingNumber
        ? `Seller dispatched order — tracking: ${order.trackingNumber}`
        : "Seller dispatched order",
      metadata: order.trackingNumber
        ? {
            trackingNumber: order.trackingNumber,
            trackingUrl: order.trackingUrl,
          }
        : null,
      createdAt: order.dispatchedAt,
      actor: null,
    });
  }

  // Terminal states
  if (order.completedAt && order.status === "completed") {
    events.push({
      id: synId(),
      type: "COMPLETED",
      actorRole: "BUYER",
      summary: "Buyer confirmed delivery — payment released to seller",
      metadata: null,
      createdAt: order.completedAt,
      actor: null,
    });
  }

  if (order.disputeOpenedAt) {
    events.push({
      id: synId(),
      type: "DISPUTE_OPENED",
      actorRole: "BUYER",
      summary: order.disputeReason
        ? `Buyer opened dispute: ${order.disputeReason.replace(/_/g, " ").toLowerCase()}`
        : "Buyer opened dispute",
      metadata: order.disputeReason ? { reason: order.disputeReason } : null,
      createdAt: order.disputeOpenedAt,
      actor: null,
    });
  }

  if (order.cancelledAt) {
    events.push({
      id: synId(),
      type: "CANCELLED",
      actorRole: order.cancelledBy === "SELLER" ? "SELLER" : "BUYER",
      summary: order.cancelReason
        ? `Order cancelled: ${order.cancelReason}`
        : "Order cancelled",
      metadata: order.cancelReason ? { reason: order.cancelReason } : null,
      createdAt: order.cancelledAt,
      actor: null,
    });
  }

  return events;
}

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetailData | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);

  // Dispatch wizard (3-step)
  const [showDispatch, setShowDispatch] = useState(false);
  const [dispatchStep, setDispatchStep] = useState(1);
  const [courierService, setCourierService] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState("");
  const [dispatchPhotos, setDispatchPhotos] = useState<File[]>([]);
  const [dispatchPhotoKeys, setDispatchPhotoKeys] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState(false);

  // Confirm delivery modal
  const [showConfirm, setShowConfirm] = useState(false);
  const [itemAsDescribed, setItemAsDescribed] = useState<"yes" | "no" | null>(
    null,
  );
  const [deliveryIssueType, setDeliveryIssueType] = useState("");
  const [deliveryPhotos, setDeliveryPhotos] = useState<File[]>([]);
  const [deliveryPhotoKeys, setDeliveryPhotoKeys] = useState<string[]>([]);
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [uploadingDeliveryPhotos, setUploadingDeliveryPhotos] = useState(false);

  // Dispute modal
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [disputePhotos, setDisputePhotos] = useState<File[]>([]);

  // (Old cancel modal state removed — replaced by interaction-based flow)

  // Seller dispute response
  const [sellerResponseText, setSellerResponseText] = useState("");
  const [showSellerResponse, setShowSellerResponse] = useState(false);

  // Cancellation interaction (new interaction-based flow)
  const [showCancelRequest, setShowCancelRequest] = useState(false);
  const [cancelRequestReason, setCancelRequestReason] = useState("");
  const [interactions, setInteractions] = useState<InteractionData[]>([]);
  const [rejectNote, setRejectNote] = useState("");

  // Return request modal
  const [showReturnRequest, setShowReturnRequest] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [returnType, setReturnType] = useState("damaged");
  const [returnResolution, setReturnResolution] = useState("full_refund");

  // Partial refund modal
  const [showPartialRefund, setShowPartialRefund] = useState(false);
  const [partialRefundReason, setPartialRefundReason] = useState("");
  const [partialRefundAmount, setPartialRefundAmount] = useState("");

  // Shipping delay modal
  const [showShippingDelay, setShowShippingDelay] = useState(false);
  const [delayReason, setDelayReason] = useState("");
  const [newEstimatedDate, setNewEstimatedDate] = useState("");

  // ProblemResolver modal
  const [showProblemResolver, setShowProblemResolver] = useState(false);

  // Counter-evidence
  const [showCounterEvidence, setShowCounterEvidence] = useState(false);
  const [counterDescription, setCounterDescription] = useState("");
  const [counterPhotos, setCounterPhotos] = useState<File[]>([]);
  const [counterPhotoKeys, setCounterPhotoKeys] = useState<string[]>([]);
  const [uploadingCounter, setUploadingCounter] = useState(false);
  const [submittingCounter, setSubmittingCounter] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const result = await fetchOrderDetail(orderId);
        if (result.success) {
          setOrder(result.data);

          // Fetch real timeline events
          const tlResult = await getOrderTimeline(orderId);
          if (tlResult.success && tlResult.data.length > 0) {
            setTimelineEvents(tlResult.data);
          } else {
            // Build synthetic events for legacy orders (created before OrderEvent system)
            setTimelineEvents(buildSyntheticEvents(result.data));
          }

          // Fetch interactions
          const intResult = await getOrderInteractions(orderId);
          if (intResult.success) {
            setInteractions(intResult.data);
          }
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
      const updated = await fetchOrderDetail(orderId);
      if (updated.success) setOrder(updated.data);
      const tlResult = await getOrderTimeline(orderId);
      if (tlResult.success && tlResult.data.length > 0) {
        setTimelineEvents(tlResult.data);
      }
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

    // Always confirm delivery (they received something)
    const result = await confirmDelivery(orderId, {
      itemAsDescribed: itemAsDescribed === "yes",
      issueType: itemAsDescribed === "no" ? deliveryIssueType : undefined,
      deliveryPhotos:
        deliveryPhotoKeys.length > 0 ? deliveryPhotoKeys : undefined,
      notes: deliveryNotes || undefined,
    });

    if (result.success) {
      if (itemAsDescribed === "yes") {
        setActionSuccess("Delivery confirmed. Payment released to seller.");
      } else {
        setActionSuccess(
          "Delivery confirmed with issue reported. The seller has been notified.",
        );
      }
      setShowConfirm(false);
      const updated = await fetchOrderDetail(orderId);
      if (updated.success) setOrder(updated.data);
      const tlResult = await getOrderTimeline(orderId);
      if (tlResult.success && tlResult.data.length > 0) {
        setTimelineEvents(tlResult.data);
      }
      // Refetch interactions (a DELIVERY_ISSUE may have been created)
      const intResult = await getOrderInteractions(orderId);
      if (intResult.success) setInteractions(intResult.data);
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

      // Upload photos first if any selected
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
        const updated = await fetchOrderDetail(orderId);
        if (updated.success) setOrder(updated.data);
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
        const updated = await fetchOrderDetail(orderId);
        if (updated.success) setOrder(updated.data);
      } else {
        setError(result.error);
      }
    } finally {
      setActionLoading(false);
    }
  }

  // ── Cancellation request handlers ─────────────────────────────────────────
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
        if (result.data.autoApproved) {
          setActionSuccess(
            "Order cancelled and refund initiated (free cancellation window).",
          );
        } else {
          setActionSuccess(
            "Cancellation request sent. The other party has 48 hours to respond.",
          );
        }
        // Refresh all data
        const updated = await fetchOrderDetail(orderId);
        if (updated.success) setOrder(updated.data);
        const tlResult = await getOrderTimeline(orderId);
        if (tlResult.success) setTimelineEvents(tlResult.data);
        const intResult = await getOrderInteractions(orderId);
        if (intResult.success) setInteractions(intResult.data);
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
        const updated = await fetchOrderDetail(orderId);
        if (updated.success) setOrder(updated.data);
        const tlResult = await getOrderTimeline(orderId);
        if (tlResult.success) setTimelineEvents(tlResult.data);
        const intResult = await getOrderInteractions(orderId);
        if (intResult.success) setInteractions(intResult.data);
      } else {
        setError(result.error);
      }
    } finally {
      setActionLoading(false);
    }
  }

  // Computed: active pending interactions
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

  // Helper to refresh all data after an interaction response
  async function refreshOrderData() {
    const updated = await fetchOrderDetail(orderId);
    if (updated.success) setOrder(updated.data);
    const tlResult = await getOrderTimeline(orderId);
    if (tlResult.success) setTimelineEvents(tlResult.data);
    const intResult = await getOrderInteractions(orderId);
    if (intResult.success) setInteractions(intResult.data);
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
      } else {
        setError(result.error);
      }
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
      } else {
        setError(result.error);
      }
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
      if (type === "RETURN_REQUEST") {
        result = await respondToReturn({
          interactionId,
          action,
          responseNote: note,
        });
      } else if (type === "PARTIAL_REFUND_REQUEST") {
        result = await respondToPartialRefund({
          interactionId,
          action,
          responseNote: note,
        });
      } else if (type === "SHIPPING_DELAY") {
        result = await respondToShippingDelay({
          interactionId,
          action,
          responseNote: note,
        });
      } else {
        result = await respondToCancellation({
          interactionId,
          action,
          responseNote: note,
        });
      }
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
      } else {
        setError(res.error);
      }
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
    } else {
      setError(res.error);
    }
    setSubmittingCounter(false);
  }

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

  const isDisputed = order.status === "disputed";
  const isCancelled = order.status === "cancelled";
  const statusInfo = getStatusInfo(order);

  // Rich status messages for "what happens next" card
  // Extract dispatch metadata for estimated delivery date / courier
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
      disputeOpenedAt: order.disputeOpenedAt,
      cancelledAt: order.cancelledAt,
      cancelReason: order.cancelReason,
      cancelledBy: order.cancelledBy,
      trackingNumber: order.trackingNumber,
      sellerRespondedAt: order.sellerRespondedAt,
      listingTitle: order.listingTitle,
      otherPartyName: order.otherPartyName,
      isBuyer: order.isBuyer,
    },
    dispatchMeta.estimatedDeliveryDate as string | null,
    dispatchMeta.courier as string | null,
  );

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
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

          {/* ── Status info box (Fix 8) ───────────────────────────────────── */}
          {statusInfo && (
            <div
              className={`rounded-2xl border p-4 mb-6 flex items-start gap-3 ${statusInfo.colour}`}
            >
              <div className="shrink-0 mt-0.5">{statusInfo.icon}</div>
              <div>
                <p className="text-[13.5px] font-semibold mb-0.5">
                  {statusInfo.title}
                </p>
                <p className="text-[12.5px] leading-relaxed opacity-80">
                  {statusInfo.message}
                </p>
              </div>
            </div>
          )}

          {/* ── Rich status card with progress + "what happens next" ─── */}
          {richStatus.whatHappensNext && (
            <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5 mb-6">
              {/* Progress bar */}
              {richStatus.progressStep > 0 && richStatus.progressTotal > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between text-[11px] text-[#9E9A91] mb-1.5">
                    <span>
                      Step {richStatus.progressStep} of{" "}
                      {richStatus.progressTotal}
                    </span>
                    {richStatus.timeRemaining && (
                      <span className="text-[#D4A843] font-medium">
                        {richStatus.timeRemaining} remaining
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 bg-[#F0EDE8] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#D4A843] rounded-full transition-all duration-500"
                      style={{
                        width: `${(richStatus.progressStep / richStatus.progressTotal) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Celebration message */}
              {richStatus.celebrationMessage && (
                <p className="text-[13.5px] font-semibold text-emerald-700 mb-2">
                  {richStatus.celebrationMessage}
                </p>
              )}

              {/* What happens next */}
              <div className="flex items-start gap-2">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#D4A843"
                  strokeWidth="2"
                  className="shrink-0 mt-0.5"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                <p className="text-[12.5px] text-[#73706A] leading-relaxed">
                  {richStatus.whatHappensNext}
                </p>
              </div>

              {/* Tracking info for dispatched orders */}
              {order.status === "dispatched" && order.trackingNumber && (
                <div className="mt-3 p-3 bg-[#FAFAF8] rounded-xl border border-[#E3E0D9] flex items-center justify-between">
                  <div className="text-[12.5px]">
                    <span className="text-[#9E9A91]">Tracking: </span>
                    {order.trackingUrl ? (
                      <a
                        href={order.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#D4A843] font-medium hover:underline font-mono"
                      >
                        {order.trackingNumber}
                      </a>
                    ) : (
                      <a
                        href={getCourierUrl(order.trackingNumber)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#D4A843] font-medium hover:underline font-mono"
                      >
                        {order.trackingNumber}
                      </a>
                    )}
                    {!!dispatchMeta.courier && (
                      <span className="text-[#9E9A91]">
                        {" "}
                        via {String(dispatchMeta.courier)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Timeline — dynamic event-driven, replaces static stepper */}
          <OrderTimeline events={timelineEvents} currentStatus={order.status} />

          {/* ── Queued auto-resolution card (counter-evidence) ─────── */}
          {isDisputed &&
            (() => {
              const queuedEvent = timelineEvents.find(
                (e) =>
                  e.type === "AUTO_RESOLVED" &&
                  (e.metadata as Record<string, unknown> | null)?.status ===
                    "QUEUED",
              );
              if (!queuedEvent) return null;
              const meta = queuedEvent.metadata as Record<string, unknown>;
              const executeAt = meta?.executeAt
                ? new Date(meta.executeAt as string)
                : null;
              const hoursLeft = executeAt
                ? Math.max(
                    0,
                    Math.ceil(
                      (executeAt.getTime() - Date.now()) / (1000 * 60 * 60),
                    ),
                  )
                : null;
              const decision = meta?.decision as string;
              const outcomeText =
                decision === "AUTO_REFUND"
                  ? "resolved with a refund to the buyer"
                  : "dismissed in the seller's favour";
              const isAffectedParty =
                (decision === "AUTO_REFUND" && !order.isBuyer) ||
                (decision === "AUTO_DISMISS" && order.isBuyer);

              return (
                <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#d97706"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-[13.5px] font-semibold text-amber-900">
                        Resolution pending
                        {hoursLeft !== null && hoursLeft > 0
                          ? ` — ${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""} remaining`
                          : " — processing soon"}
                      </p>
                      <p className="text-[12.5px] text-amber-800 mt-1">
                        Based on the evidence reviewed, this dispute is
                        scheduled to be <strong>{outcomeText}</strong>.
                      </p>

                      {isAffectedParty && (
                        <div className="mt-3">
                          {!showCounterEvidence ? (
                            <button
                              type="button"
                              onClick={() => setShowCounterEvidence(true)}
                              className="text-[12.5px] font-semibold text-amber-800 hover:text-amber-900 underline transition"
                            >
                              Have additional evidence? Submit it now
                            </button>
                          ) : (
                            <div className="mt-2 space-y-3 bg-white rounded-xl p-4 border border-amber-200">
                              <textarea
                                value={counterDescription}
                                onChange={(e) =>
                                  setCounterDescription(e.target.value)
                                }
                                placeholder="Describe your evidence..."
                                rows={3}
                                maxLength={2000}
                                className="w-full px-3 py-2 rounded-lg border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition resize-none"
                              />
                              {counterPhotos.length > 0 && (
                                <div className="flex gap-2 flex-wrap">
                                  {counterPhotos.map((f, i) => (
                                    <div
                                      key={i}
                                      className="relative w-14 h-14 rounded-lg overflow-hidden border border-[#E3E0D9]"
                                    >
                                      <img
                                        src={URL.createObjectURL(f)}
                                        alt={`Evidence ${i + 1}`}
                                        className="w-full h-full object-cover"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCounterPhotos((p) =>
                                            p.filter((_, idx) => idx !== i),
                                          );
                                          setCounterPhotoKeys((k) =>
                                            k.filter((_, idx) => idx !== i),
                                          );
                                        }}
                                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/60 text-white text-[9px] flex items-center justify-center"
                                      >
                                        &times;
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {counterPhotos.length < 4 && (
                                <label
                                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-[12px] font-medium transition ${uploadingCounter ? "text-[#9E9A91] cursor-wait" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843] hover:text-[#D4A843]"}`}
                                >
                                  {uploadingCounter
                                    ? "Uploading..."
                                    : "Add photos"}
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    multiple
                                    className="hidden"
                                    disabled={uploadingCounter}
                                    onChange={(e) => {
                                      handleUploadCounterPhotos(
                                        Array.from(e.target.files ?? []).slice(
                                          0,
                                          4 - counterPhotos.length,
                                        ),
                                      );
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              )}
                              <div className="flex gap-2">
                                <Button
                                  variant="gold"
                                  size="sm"
                                  onClick={handleSubmitCounterEvidence}
                                  loading={submittingCounter}
                                  disabled={
                                    counterDescription.length < 10 ||
                                    uploadingCounter
                                  }
                                >
                                  Submit evidence
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setShowCounterEvidence(false)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {!isAffectedParty && (
                        <p className="text-[12px] text-amber-700 mt-2">
                          The other party has been notified and can submit
                          counter-evidence before the resolution takes effect.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

          {/* ── Dispute transparency card (both parties see same info) ── */}
          {isDisputed && (
            <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5 mb-6">
              <h3 className="text-[13.5px] font-semibold text-[#141414] mb-3">
                Dispute status
              </h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="text-[#9E9A91]">Status:</span>
                  <span
                    className={`font-medium ${order.sellerRespondedAt ? "text-sky-700" : "text-amber-700"}`}
                  >
                    {order.sellerRespondedAt
                      ? "Under review"
                      : "Awaiting seller response"}
                  </span>
                </div>
                {order.disputeReason && (
                  <div className="text-[12.5px]">
                    <span className="text-[#9E9A91]">Reason: </span>
                    <span className="text-[#141414]">
                      {order.disputeReason.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </div>
                )}
                {order.disputeNotes && (
                  <div className="text-[12.5px]">
                    <span className="text-[#9E9A91]">Description: </span>
                    <span className="text-[#141414] line-clamp-3">
                      {order.disputeNotes}
                    </span>
                  </div>
                )}
                {order.sellerRespondedAt && order.sellerResponse && (
                  <div className="bg-[#FAFAF8] rounded-xl p-3 border border-[#E3E0D9]">
                    <p className="text-[11.5px] text-[#9E9A91] font-medium mb-1">
                      Seller response (
                      {new Date(order.sellerRespondedAt).toLocaleDateString(
                        "en-NZ",
                        { day: "numeric", month: "short" },
                      )}
                      )
                    </p>
                    <p className="text-[12.5px] text-[#141414] line-clamp-4">
                      {order.sellerResponse}
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
          )}

          {/* Dispute details — separate from timeline for seller response form */}
          <div className="mb-6">
            {/* Dispute details if disputed */}
            {isDisputed && (
              <div className="mt-5 space-y-3">
                {/* Seller response countdown timer */}
                {!order.isBuyer &&
                  !order.sellerResponse &&
                  order.disputeOpenedAt && (
                    <DisputeCountdownTimer
                      disputeOpenedAt={order.disputeOpenedAt}
                    />
                  )}

                {/* Buyer's dispute claim */}
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[12.5px] text-red-800">
                  <p className="font-semibold mb-1">Dispute details</p>
                  {order.disputeReason && (
                    <p>
                      Reason:{" "}
                      {order.disputeReason.replace(/_/g, " ").toLowerCase()}
                    </p>
                  )}
                  {order.disputeNotes && (
                    <p className="mt-1.5 whitespace-pre-wrap">
                      {order.disputeNotes}
                    </p>
                  )}
                  {/* Trust & Safety message is shown in the top status banner */}
                </div>

                {/* Seller's response (if submitted) */}
                {order.sellerResponse && (
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
                      {order.sellerResponse}
                    </p>
                    {order.sellerRespondedAt && (
                      <p className="mt-1.5 text-[11px] opacity-60">
                        Responded {fmtDate(order.sellerRespondedAt)}
                      </p>
                    )}
                  </div>
                )}

                {/* Seller response form (if seller hasn't responded yet) */}
                {!order.isBuyer &&
                  !order.sellerResponse &&
                  !showSellerResponse && (
                    <button
                      type="button"
                      onClick={() => setShowSellerResponse(true)}
                      className="w-full p-3 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/50
                      text-[12.5px] text-amber-800 font-semibold hover:bg-amber-50 transition-colors"
                    >
                      Respond to this dispute →
                    </button>
                  )}

                {!order.isBuyer &&
                  !order.sellerResponse &&
                  showSellerResponse && (
                    <div className="p-4 rounded-xl bg-white border border-[#E3E0D9]">
                      <label className="text-[12.5px] font-semibold text-[#141414] mb-1.5 block">
                        Your response
                      </label>
                      <textarea
                        value={sellerResponseText}
                        onChange={(e) => setSellerResponseText(e.target.value)}
                        placeholder="Explain your side of the situation (min 20 characters)..."
                        rows={4}
                        maxLength={2000}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                        text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                        focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
                      />
                      <p className="text-[11px] text-[#9E9A91] mt-1 mb-3">
                        {sellerResponseText.length}/2000 characters
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="gold"
                          size="sm"
                          onClick={handleSellerResponse}
                          loading={actionLoading}
                        >
                          Submit response
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowSellerResponse(false);
                            setSellerResponseText("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                      <p className="text-[11px] text-[#9E9A91] mt-2">
                        Your response will be shared with the buyer and our
                        Trust &amp; Safety team.
                      </p>
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* Pending cancellation request — notification for the other party */}
          {pendingCancelRequest && (
            <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5 mb-6">
              <div className="flex items-start gap-3">
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
                    {new Date(
                      pendingCancelRequest.expiresAt,
                    ).toLocaleDateString("en-NZ", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    — auto-approves if no response
                  </p>

                  {/* If current user is NOT the initiator, show accept/reject */}
                  {pendingCancelRequest.initiator.id !==
                    (order.isBuyer ? order.buyerId : order.sellerId) && (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="danger"
                          size="sm"
                          loading={actionLoading}
                          onClick={() =>
                            handleRespondToCancellation(
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
                          onClick={() => {
                            // Toggle reject note textarea
                            setRejectNote(rejectNote ? "" : " ");
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                      {rejectNote !== "" && (
                        <div>
                          <textarea
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                            placeholder="Explain why you're rejecting (min 10 characters)..."
                            rows={3}
                            maxLength={500}
                            className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                              text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                              focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
                          />
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={actionLoading}
                            disabled={rejectNote.trim().length < 10}
                            onClick={() =>
                              handleRespondToCancellation(
                                pendingCancelRequest.id,
                                "REJECT",
                              )
                            }
                            className="mt-2"
                          >
                            Submit rejection
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* If current user IS the initiator, show pending status */}
                  {pendingCancelRequest.initiator.id ===
                    (order.isBuyer ? order.buyerId : order.sellerId) && (
                    <p className="mt-3 text-[12px] text-amber-700 font-medium">
                      Waiting for the other party to respond...
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Pending interactions — return, partial refund, shipping delay */}
          {[pendingReturnRequest, pendingPartialRefund, pendingShippingDelay]
            .filter(Boolean)
            .map((interaction) => {
              const ix = interaction!;
              const currentUserId = order.isBuyer
                ? order.buyerId
                : order.sellerId;
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
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold text-amber-900">
                        {typeLabels[ix.type] ?? ix.type.replace(/_/g, " ")}
                        {ix.status === "COUNTERED" && " — counter-offer"}
                      </p>
                      <p className="text-[12.5px] text-amber-800 mt-1">
                        {ix.initiatorRole === "BUYER"
                          ? "The buyer"
                          : "The seller"}{" "}
                        {ix.type === "SHIPPING_DELAY"
                          ? "notified a shipping delay."
                          : `made this request.`}
                      </p>
                      <p className="text-[12px] text-amber-700 mt-1 italic">
                        &ldquo;{ix.reason}&rdquo;
                      </p>
                      {!!details.requestedAmount && (
                        <p className="text-[12px] text-amber-800 mt-1 font-medium">
                          Amount: $
                          {(Number(details.requestedAmount) / 100).toFixed(2)}{" "}
                          NZD
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
                          Type:{" "}
                          {String(details.returnReason).replace(/_/g, " ")}
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

                      {/* Respond buttons for the OTHER party */}
                      {!isInitiator && ix.status === "PENDING" && (
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="gold"
                              size="sm"
                              loading={actionLoading}
                              onClick={() =>
                                handleRespondToInteraction(
                                  ix.id,
                                  ix.type,
                                  "ACCEPT",
                                )
                              }
                            >
                              Accept
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setRejectNote(rejectNote ? "" : " ")
                              }
                            >
                              Reject
                            </Button>
                          </div>
                          {rejectNote !== "" && (
                            <div>
                              <textarea
                                value={rejectNote}
                                onChange={(e) => setRejectNote(e.target.value)}
                                placeholder="Explain why you're rejecting (min 10 characters)..."
                                rows={3}
                                maxLength={500}
                                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                                  text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                                  focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
                              />
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={actionLoading}
                                disabled={rejectNote.trim().length < 10}
                                onClick={() =>
                                  handleRespondToInteraction(
                                    ix.id,
                                    ix.type,
                                    "REJECT",
                                    rejectNote.trim(),
                                  )
                                }
                                className="mt-2"
                              >
                                Submit rejection
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Counter-offer: show accept/reject for the original requester */}
                      {isInitiator && ix.status === "COUNTERED" && (
                        <div className="mt-4 flex items-center gap-2">
                          <Button
                            variant="gold"
                            size="sm"
                            loading={actionLoading}
                            onClick={() =>
                              handleRespondToInteraction(
                                ix.id,
                                ix.type,
                                "ACCEPT",
                              )
                            }
                          >
                            Accept counter-offer
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={actionLoading}
                            onClick={() =>
                              handleRespondToInteraction(
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

                      {/* Status for initiator */}
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
                  <span className="text-[#141414]">
                    {formatPrice(order.total)}
                  </span>
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
                href={
                  order.isBuyer ? `/sellers/${order.otherPartyUsername}` : "#"
                }
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
                    href={
                      order.trackingUrl || getCourierUrl(order.trackingNumber)
                    }
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

          {/* Cancellation audit trail (Fix 9) */}
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

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            {/* Seller: mark dispatched */}
            {!order.isBuyer && order.status === "payment_held" && (
              <Button
                variant="gold"
                size="md"
                onClick={() => setShowDispatch(true)}
              >
                Mark as dispatched
              </Button>
            )}

            {/* Buyer: confirm delivery */}
            {order.isBuyer &&
              (order.status === "dispatched" ||
                order.status === "delivered") && (
                <Button
                  variant="gold"
                  size="md"
                  onClick={() => setShowConfirm(true)}
                >
                  Confirm delivery
                </Button>
              )}

            {/* Buyer: open dispute */}
            {order.isBuyer &&
              (order.status === "dispatched" || order.status === "delivered") &&
              !order.disputeReason && (
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => setShowDispute(true)}
                >
                  Open a dispute
                </Button>
              )}

            {/* Cancel order — interaction-based flow */}
            {(order.status === "payment_held" ||
              order.status === "awaiting_payment") &&
              !pendingCancelRequest && (
                <Button
                  variant="danger"
                  size="md"
                  onClick={() => setShowCancelRequest(true)}
                >
                  Request cancellation
                </Button>
              )}

            {/* Buyer: request return (completed/delivered) */}
            {order.isBuyer &&
              (order.status === "completed" || order.status === "delivered") &&
              !pendingReturnRequest && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setShowReturnRequest(true)}
                >
                  Request return
                </Button>
              )}

            {/* Buyer or Seller: request partial refund (completed/delivered) */}
            {(order.status === "completed" || order.status === "delivered") &&
              !pendingPartialRefund && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setShowPartialRefund(true)}
                >
                  {order.isBuyer
                    ? "Request partial refund"
                    : "Offer partial refund"}
                </Button>
              )}

            {/* Seller: notify shipping delay (before dispatch) */}
            {!order.isBuyer &&
              (order.status === "payment_held" ||
                order.status === "awaiting_payment") &&
              !pendingShippingDelay && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setShowShippingDelay(true)}
                >
                  Notify shipping delay
                </Button>
              )}

            {/* Buyer: leave review */}
            {order.isBuyer &&
              order.status === "completed" &&
              !order.hasReview && (
                <Link href={`/reviews/new?orderId=${order.id}`}>
                  <Button variant="secondary" size="md">
                    Leave a review
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

            {/* Buyer: unified "Need help?" — replaces individual dispute/cancel/return buttons */}
            {order.isBuyer &&
              !["awaiting_payment", "cancelled", "refunded"].includes(
                order.status,
              ) &&
              !order.disputeReason && (
                <button
                  type="button"
                  onClick={() => setShowProblemResolver(true)}
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
        </div>
      </main>
      <Footer />

      {/* ── Dispatch Wizard (3-step) ───────────────────────────────── */}
      {showDispatch && (
        <ModalOverlay
          onClose={() => {
            setShowDispatch(false);
            setDispatchStep(1);
            setDispatchSuccess(false);
          }}
        >
          {dispatchSuccess ? (
            /* ── Success State ─────────────────────────────────────── */
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2">
                Dispatched!
              </h2>
              <p className="text-[13px] text-[#73706A] mb-4">
                {order.otherPartyName} will be notified immediately.
                {estimatedDeliveryDate && (
                  <>
                    {" "}
                    Estimated delivery:{" "}
                    <strong>
                      {new Date(estimatedDeliveryDate).toLocaleDateString(
                        "en-NZ",
                        { weekday: "short", day: "numeric", month: "short" },
                      )}
                    </strong>
                    .
                  </>
                )}
              </p>
              <div className="bg-sky-50 rounded-xl border border-sky-200 p-4 text-left mb-4">
                <p className="text-[12.5px] text-sky-800 font-semibold mb-1">
                  What happens next
                </p>
                <ul className="text-[12px] text-sky-700 space-y-1 list-disc list-inside">
                  <li>
                    The buyer has up to 14 days after delivery to confirm
                    receipt
                  </li>
                  <li>Payment will be released once they confirm</li>
                  <li>
                    If they don&apos;t respond, payment is released
                    automatically
                  </li>
                </ul>
              </div>
              <Button
                variant="gold"
                fullWidth
                size="md"
                onClick={() => {
                  setShowDispatch(false);
                  setDispatchStep(1);
                  setDispatchSuccess(false);
                }}
              >
                Done
              </Button>
            </div>
          ) : (
            /* ── Wizard Steps ──────────────────────────────────────── */
            <div>
              {/* Step indicators */}
              <div className="flex items-center gap-2 mb-5">
                {[1, 2, 3].map((s) => (
                  <div key={s} className="flex items-center gap-2 flex-1">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0
                      ${dispatchStep >= s ? "bg-[#D4A843] text-white" : "bg-[#F0EDE8] text-[#9E9A91]"}`}
                    >
                      {dispatchStep > s ? (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        s
                      )}
                    </div>
                    {s < 3 && (
                      <div
                        className={`flex-1 h-0.5 ${dispatchStep > s ? "bg-[#D4A843]" : "bg-[#E3E0D9]"}`}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="max-h-[65vh] overflow-y-auto pr-1">
                {/* ── Step 1: Photos ──────────────────────────────── */}
                {dispatchStep === 1 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="font-[family-name:var(--font-playfair)] text-[1.05rem] font-semibold text-[#141414] mb-1">
                        Photo your item before packing
                      </h2>
                      <p className="text-[12.5px] text-[#73706A]">
                        These photos protect you if a buyer claims damage. Show
                        the item from multiple angles.
                      </p>
                    </div>

                    {dispatchPhotos.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {dispatchPhotos.map((f, i) => (
                          <div
                            key={i}
                            className="relative w-20 h-20 rounded-xl overflow-hidden border border-[#E3E0D9]"
                          >
                            <img
                              src={URL.createObjectURL(f)}
                              alt={`Photo ${i + 1}`}
                              className="w-full h-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setDispatchPhotos((p) =>
                                  p.filter((_, idx) => idx !== i),
                                );
                                setDispatchPhotoKeys((k) =>
                                  k.filter((_, idx) => idx !== i),
                                );
                              }}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center"
                            >
                              &times;
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {dispatchPhotos.length < 4 && (
                      <label
                        className={`flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-xl border-2 border-dashed cursor-pointer transition
                        ${uploadingPhotos ? "border-[#D4A843]/40 text-[#9E9A91] cursor-wait" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843] hover:text-[#D4A843]"}`}
                      >
                        {uploadingPhotos ? (
                          <span className="text-[13px] font-medium">
                            Uploading...
                          </span>
                        ) : (
                          <>
                            <svg
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            >
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <circle cx="8.5" cy="8.5" r="1.5" />
                              <path d="m21 15-5-5L5 21" />
                            </svg>
                            <span className="text-[13px] font-medium">
                              Add photos (1-4 required)
                            </span>
                            <span className="text-[11px] text-[#9E9A91]">
                              JPG, PNG, or WebP up to 5MB each
                            </span>
                          </>
                        )}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          className="hidden"
                          disabled={uploadingPhotos}
                          onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            handleUploadDispatchPhotos(
                              files.slice(0, 4 - dispatchPhotos.length),
                            );
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}

                    <Button
                      variant="gold"
                      fullWidth
                      size="md"
                      disabled={
                        dispatchPhotoKeys.length === 0 || uploadingPhotos
                      }
                      onClick={() => setDispatchStep(2)}
                    >
                      Next: Shipping details
                    </Button>
                  </div>
                )}

                {/* ── Step 2: Shipping details ───────────────────── */}
                {dispatchStep === 2 && (
                  <div className="space-y-4">
                    <h2 className="font-[family-name:var(--font-playfair)] text-[1.05rem] font-semibold text-[#141414] mb-1">
                      Shipping details
                    </h2>
                    <p className="text-[12.5px] text-[#73706A] -mt-2">
                      The buyer will see the estimated date. We&apos;ll send
                      them reminders if it passes.
                    </p>

                    <div>
                      <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                        Courier <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={courierService}
                        onChange={(e) => setCourierService(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                      >
                        <option value="">Select courier...</option>
                        {VALID_COURIERS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                        Tracking number <span className="text-red-500">*</span>
                      </label>
                      <input
                        value={trackingNumber}
                        onChange={(e) => setTrackingNumber(e.target.value)}
                        placeholder="e.g. NZ123456789"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                      />
                    </div>

                    <div>
                      <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                        Tracking URL{" "}
                        <span className="text-[#9E9A91] font-normal">
                          (optional)
                        </span>
                      </label>
                      <input
                        value={trackingUrl}
                        onChange={(e) => setTrackingUrl(e.target.value)}
                        placeholder="e.g. https://nzpost.co.nz/track/..."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                      />
                    </div>

                    <div>
                      <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                        Estimated delivery date{" "}
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={estimatedDeliveryDate}
                        onChange={(e) =>
                          setEstimatedDeliveryDate(e.target.value)
                        }
                        min={
                          new Date(Date.now() + 86400000)
                            .toISOString()
                            .split("T")[0]
                        }
                        max={
                          new Date(Date.now() + 14 * 86400000)
                            .toISOString()
                            .split("T")[0]
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                      />
                      <p className="text-[11px] text-[#9E9A91] mt-1">
                        1-14 business days from today
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        variant="ghost"
                        size="md"
                        onClick={() => setDispatchStep(1)}
                        className="flex-1"
                      >
                        Back
                      </Button>
                      <Button
                        variant="gold"
                        size="md"
                        className="flex-1"
                        disabled={
                          !courierService ||
                          !trackingNumber ||
                          !estimatedDeliveryDate
                        }
                        onClick={() => setDispatchStep(3)}
                      >
                        Next: Review
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Step 3: Confirm & dispatch ─────────────────── */}
                {dispatchStep === 3 && (
                  <div className="space-y-4">
                    <h2 className="font-[family-name:var(--font-playfair)] text-[1.05rem] font-semibold text-[#141414]">
                      Confirm &amp; dispatch
                    </h2>

                    {/* Summary card */}
                    <div className="bg-[#FAFAF8] rounded-xl border border-[#E3E0D9] p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        {order.listingThumbnail && (
                          <img
                            src={order.listingThumbnail}
                            alt=""
                            className="w-12 h-12 rounded-lg object-cover border border-[#E3E0D9]"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[#141414] line-clamp-1">
                            {order.listingTitle}
                          </p>
                          <p className="text-[12px] text-[#73706A]">
                            To: {order.otherPartyName}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[12px]">
                        <div>
                          <span className="text-[#9E9A91]">Courier:</span>{" "}
                          <span className="text-[#141414] font-medium">
                            {courierService}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#9E9A91]">Tracking:</span>{" "}
                          <span className="text-[#141414] font-medium font-mono">
                            {trackingNumber}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#9E9A91]">Est. delivery:</span>{" "}
                          <span className="text-[#141414] font-medium">
                            {estimatedDeliveryDate
                              ? new Date(
                                  estimatedDeliveryDate,
                                ).toLocaleDateString("en-NZ", {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                })
                              : "—"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#9E9A91]">Photos:</span>{" "}
                          <span className="text-[#141414] font-medium">
                            {dispatchPhotoKeys.length} uploaded
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-sky-50 rounded-xl border border-sky-200 p-3 text-[12px] text-sky-800">
                      Once confirmed, {order.otherPartyName} will be notified
                      immediately with your tracking details.
                    </div>

                    <div className="flex gap-3">
                      <Button
                        variant="ghost"
                        size="md"
                        onClick={() => setDispatchStep(2)}
                        className="flex-1"
                      >
                        Back
                      </Button>
                      <Button
                        variant="gold"
                        size="md"
                        className="flex-1"
                        onClick={handleDispatch}
                        loading={actionLoading}
                      >
                        Confirm dispatch
                      </Button>
                    </div>

                    <p className="text-[11px] text-[#9E9A91] text-center">
                      Payment is released only after the buyer confirms delivery
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </ModalOverlay>
      )}

      {/* ── Confirm Delivery Modal (enhanced with structured feedback) ── */}
      {showConfirm && (
        <ModalOverlay onClose={() => setShowConfirm(false)}>
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2 text-center">
            Confirm delivery
          </h2>
          <p className="text-[13px] text-[#73706A] mb-4 text-center">
            Confirming delivery will release{" "}
            <span className="font-semibold text-[#141414]">
              {formatPrice(order.total)}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-[#141414]">
              {order.otherPartyName}
            </span>
            .
          </p>

          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            {/* Item condition question */}
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-2 block">
                Did the item arrive as described?{" "}
                <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setItemAsDescribed("yes")}
                  className={`flex-1 py-2.5 rounded-xl border text-[13px] font-medium transition
                    ${itemAsDescribed === "yes" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843]"}`}
                >
                  Yes, all good
                </button>
                <button
                  type="button"
                  onClick={() => setItemAsDescribed("no")}
                  className={`flex-1 py-2.5 rounded-xl border text-[13px] font-medium transition
                    ${itemAsDescribed === "no" ? "border-red-500 bg-red-50 text-red-700" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843]"}`}
                >
                  No, there&apos;s an issue
                </button>
              </div>
            </div>

            {/* Issue details (shown if "No") */}
            {itemAsDescribed === "no" && (
              <>
                <div>
                  <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                    What&apos;s wrong? <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={deliveryIssueType}
                    onChange={(e) => setDeliveryIssueType(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                      text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25
                      focus:border-[#D4A843] transition"
                  >
                    <option value="">Select issue...</option>
                    <option value="DAMAGED">Damaged</option>
                    <option value="WRONG_ITEM">Wrong item</option>
                    <option value="MISSING_PARTS">Missing parts</option>
                    <option value="NOT_AS_DESCRIBED">Not as described</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                {/* Photos of received item */}
                <div>
                  <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                    Photos of received item{" "}
                    <span className="text-[#9E9A91] font-normal">
                      (optional, max 4)
                    </span>
                  </label>
                  {deliveryPhotos.length > 0 && (
                    <div className="flex gap-2 flex-wrap mb-2">
                      {deliveryPhotos.map((f, i) => (
                        <div
                          key={i}
                          className="relative w-14 h-14 rounded-lg overflow-hidden border border-[#E3E0D9]"
                        >
                          <img
                            src={URL.createObjectURL(f)}
                            alt={`Delivery photo ${i + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setDeliveryPhotos((p) =>
                                p.filter((_, idx) => idx !== i),
                              );
                              setDeliveryPhotoKeys((k) =>
                                k.filter((_, idx) => idx !== i),
                              );
                            }}
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white
                              text-[9px] flex items-center justify-center shadow"
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {deliveryPhotos.length < 4 && (
                    <label
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl border-2
                        border-dashed cursor-pointer transition text-[12px] font-medium
                        ${uploadingDeliveryPhotos ? "border-[#D4A843]/40 text-[#9E9A91] cursor-wait" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843] hover:text-[#D4A843]"}`}
                    >
                      {uploadingDeliveryPhotos ? "Uploading..." : "Add photos"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="hidden"
                        disabled={uploadingDeliveryPhotos}
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          const remaining = 4 - deliveryPhotos.length;
                          handleUploadDeliveryPhotos(files.slice(0, remaining));
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                    Notes{" "}
                    <span className="text-[#9E9A91] font-normal">
                      (optional)
                    </span>
                  </label>
                  <textarea
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="Describe the issue..."
                    rows={3}
                    maxLength={2000}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                      text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                      focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition resize-none"
                  />
                </div>

                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-left">
                  <p className="text-[12px] text-amber-800">
                    The seller will be notified of the issue and has 72 hours to
                    respond. If unresolved, it will be escalated to our team.
                  </p>
                </div>
              </>
            )}

            {itemAsDescribed === "yes" && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-left">
                <p className="text-[12px] text-amber-800 font-semibold flex items-center gap-1.5">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  This action cannot be undone
                </p>
                <p className="text-[11.5px] text-amber-700 mt-1">
                  Payment will be released to the seller immediately.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button
                variant="gold"
                fullWidth
                size="md"
                onClick={handleConfirmDelivery}
                loading={actionLoading}
                disabled={
                  itemAsDescribed === null ||
                  (itemAsDescribed === "no" && !deliveryIssueType) ||
                  uploadingDeliveryPhotos
                }
              >
                {itemAsDescribed === "no"
                  ? "Confirm delivery & report issue"
                  : `Yes, I received it — release ${formatPrice(order.total)}`}
              </Button>
              <Button
                variant="ghost"
                fullWidth
                size="md"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </Button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  setShowDispute(true);
                }}
                className="text-[12px] text-red-500 hover:text-red-600 font-medium mt-1 transition-colors"
              >
                Something wrong? Open a dispute instead
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Cancellation Request Modal ─────────────────────────────── */}
      {showCancelRequest && (
        <ModalOverlay onClose={() => setShowCancelRequest(false)}>
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg
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
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2">
              Request cancellation
            </h2>
            <p className="text-[13px] text-[#73706A] mb-4">
              If the order was placed less than 2 hours ago, it will be
              cancelled immediately. Otherwise, the other party has 48 hours to
              respond.
            </p>

            <div className="text-left mb-4">
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Reason for cancellation
              </label>
              <textarea
                value={cancelRequestReason}
                onChange={(e) => setCancelRequestReason(e.target.value)}
                placeholder="Please explain why you need to cancel (min 10 characters)..."
                rows={3}
                maxLength={500}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                  focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
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
                Within the 2-hour free window: order is cancelled immediately
                and a full refund is issued. After 2 hours: the other party has
                48 hours to accept or reject. If no response, the cancellation
                is auto-approved.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant="danger"
                fullWidth
                size="md"
                onClick={handleRequestCancellation}
                loading={actionLoading}
                disabled={cancelRequestReason.trim().length < 10}
              >
                Submit cancellation request
              </Button>
              <Button
                variant="ghost"
                fullWidth
                size="md"
                onClick={() => {
                  setShowCancelRequest(false);
                  setCancelRequestReason("");
                }}
              >
                Keep order
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Return Request Modal ──────────────────────────────────── */}
      {showReturnRequest && (
        <ModalOverlay onClose={() => setShowReturnRequest(false)}>
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4">
            Request a return
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Return reason
              </label>
              <select
                value={returnType}
                onChange={(e) => setReturnType(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]"
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
                onChange={(e) => setReturnResolution(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]"
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
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Describe the issue in detail (min 10 characters)..."
                rows={4}
                maxLength={500}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                  focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
              />
              <p className="text-[11px] text-[#9E9A91] mt-1">
                {returnReason.length}/500 characters
              </p>
            </div>
            <Alert variant="info">
              The seller has 72 hours to respond. If they don&apos;t respond,
              this will automatically escalate to a dispute.
            </Alert>
            <Button
              variant="gold"
              fullWidth
              size="md"
              onClick={handleRequestReturn}
              loading={actionLoading}
              disabled={returnReason.trim().length < 10}
            >
              Submit return request
            </Button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Partial Refund Modal ───────────────────────────────────── */}
      {showPartialRefund && order && (
        <ModalOverlay onClose={() => setShowPartialRefund(false)}>
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4">
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
                  onChange={(e) => setPartialRefundAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                    text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]"
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
                onChange={(e) => setPartialRefundReason(e.target.value)}
                placeholder="Explain why a partial refund is appropriate (min 10 characters)..."
                rows={4}
                maxLength={500}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                  focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
              />
              <p className="text-[11px] text-[#9E9A91] mt-1">
                {partialRefundReason.length}/500 characters
              </p>
            </div>
            <Alert variant="info">
              The other party has 48 hours to accept, reject, or counter-offer.
              Accepted partial refunds will be processed by the KiwiMart team.
            </Alert>
            <Button
              variant="gold"
              fullWidth
              size="md"
              onClick={handleRequestPartialRefund}
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
      )}

      {/* ── Shipping Delay Modal ───────────────────────────────────── */}
      {showShippingDelay && (
        <ModalOverlay onClose={() => setShowShippingDelay(false)}>
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4">
            Notify shipping delay
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Reason for delay
              </label>
              <textarea
                value={delayReason}
                onChange={(e) => setDelayReason(e.target.value)}
                placeholder="Explain the reason for the delay (min 10 characters)..."
                rows={4}
                maxLength={500}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                  focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
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
                onChange={(e) => setNewEstimatedDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]"
              />
            </div>
            <Alert variant="info">
              The buyer will be notified of the delay. They can acknowledge it
              or request a cancellation if preferred. If no response in 7 days,
              it auto-resolves.
            </Alert>
            <Button
              variant="gold"
              fullWidth
              size="md"
              onClick={handleNotifyShippingDelay}
              loading={actionLoading}
              disabled={delayReason.trim().length < 10}
            >
              Send notification
            </Button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Dispute Modal (Fix 4 — expanded categories) ───────────── */}
      {showDispute && (
        <ModalOverlay onClose={() => setShowDispute(false)}>
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4">
            Open a dispute
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Reason
              </label>
              <select
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25
                  focus:border-[#D4A843] transition"
              >
                <option value="">Select a reason</option>
                <option value="ITEM_NOT_RECEIVED">Item not received</option>
                <option value="ITEM_NOT_AS_DESCRIBED">
                  Item not as described
                </option>
                <option value="ITEM_DAMAGED">Item damaged in transit</option>
                <option value="WRONG_ITEM_SENT">Wrong item sent</option>
                <option value="COUNTERFEIT_ITEM">Suspected counterfeit</option>
                <option value="SELLER_UNRESPONSIVE">Seller unresponsive</option>
                <option value="SELLER_CANCELLED">
                  Seller cancelled after payment
                </option>
                <option value="REFUND_NOT_PROCESSED">
                  Refund not processed
                </option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Describe the issue
              </label>
              <textarea
                value={disputeDescription}
                onChange={(e) => setDisputeDescription(e.target.value)}
                placeholder="Please describe what happened (min 20 characters)..."
                rows={4}
                maxLength={2000}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                  focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
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
                <label
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed
                  border-[#C9C5BC] bg-[#FAFAF8] text-[12.5px] text-[#73706A] cursor-pointer
                  hover:border-[#D4A843] hover:bg-[#F5ECD4]/20 transition-colors"
                >
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
                      const files = Array.from(e.target.files ?? []).slice(
                        0,
                        3,
                      );
                      setDisputePhotos(files);
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
              Our team will review your dispute within 48 hours. The seller will
              be notified and given an opportunity to respond.
            </Alert>
            <Button
              variant="danger"
              fullWidth
              size="md"
              onClick={handleOpenDispute}
              loading={actionLoading}
            >
              Submit dispute
            </Button>
          </div>
        </ModalOverlay>
      )}

      {/* ── ProblemResolver Modal ─────────────────────────────────── */}
      {showProblemResolver && (
        <ModalOverlay onClose={() => setShowProblemResolver(false)}>
          <ProblemResolver
            orderId={orderId}
            status={order.status}
            listingTitle={order.listingTitle}
            sellerName={order.otherPartyName}
            totalNzd={order.total}
            onClose={() => setShowProblemResolver(false)}
            onSuccess={refreshOrderData}
          />
        </ModalOverlay>
      )}
    </>
  );
}

// ── Shared types ────────────────────────────────────────────────────────────

interface OrderDetailData {
  id: string;
  listingId: string;
  listingTitle: string;
  listingThumbnail: string;
  status: string;
  itemPrice: number;
  shippingPrice: number;
  total: number;
  createdAt: string;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  disputeOpenedAt: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  disputeReason: string | null;
  disputeNotes: string | null;
  sellerResponse: string | null;
  sellerRespondedAt: string | null;
  isBuyer: boolean;
  buyerId: string;
  sellerId: string;
  otherPartyName: string;
  otherPartyUsername: string;
  hasReview: boolean;
  cancelledBy: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
}

// ── Modal wrapper ───────────────────────────────────────────────────────────

function ModalOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[#F8F7F4] flex items-center
            justify-center hover:bg-[#EFEDE8] transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}

// ── Status info icons ─────────────────────────────────────────────────────

function CreditCardIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function PackageIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
function TruckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}
function CheckCircleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
// ── Dispute Countdown Timer ─────────────────────────────────────────────────
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

function AlertTriangleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function RefundIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}
function XCircleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
