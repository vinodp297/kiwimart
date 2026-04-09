"use client";
// src/app/(protected)/orders/[id]/hooks/useOrderActions.ts
// ─── All order-action state + handlers in one place ──────────────────────────
//
// Owns: activeModal, every form field, actionLoading/Success/error, and every
// async handler.  The parent client component stays at ≤ 3 useState.

import { useState } from "react";
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
import {
  requestCancellation,
  respondToCancellation,
  requestReturn,
  respondToReturn,
  requestPartialRefund,
  respondToPartialRefund,
  notifyShippingDelay,
  respondToShippingDelay,
} from "@/server/actions/interactions";
import { submitCounterEvidence } from "@/server/actions/counterEvidence";

// ── Modal union ───────────────────────────────────────────────────────────────

export type ModalType =
  | "dispatch"
  | "confirm"
  | "dispute"
  | "cancelRequest"
  | "returnRequest"
  | "partialRefund"
  | "shippingDelay"
  | "problemResolver"
  | "sellerResponse"
  | "counterEvidence";

// ── Pure validation helpers (also exported for unit tests) ───────────────────

export function validateDispatch(state: {
  courierService: string;
  trackingNumber: string;
  estimatedDeliveryDate: string;
  dispatchPhotoKeys: string[];
}): string | null {
  if (!state.courierService) return "Please select a courier service.";
  if (!state.trackingNumber) return "Please enter a tracking number.";
  if (!state.estimatedDeliveryDate)
    return "Please select an estimated delivery date.";
  if (state.dispatchPhotoKeys.length === 0)
    return "Please upload at least 1 dispatch photo.";
  return null;
}

export function validateConfirmDelivery(state: {
  itemAsDescribed: "yes" | "no" | null;
  deliveryIssueType: string;
}): string | null {
  if (state.itemAsDescribed === null)
    return "Please confirm whether the item arrived as described.";
  if (state.itemAsDescribed === "no" && !state.deliveryIssueType)
    return "Please select what's wrong with the item.";
  return null;
}

export function validateDispute(state: {
  disputeReason: string;
  disputeDescription: string;
}): string | null {
  if (!state.disputeReason || state.disputeDescription.length < 20)
    return "Please select a reason and describe the issue (at least 20 characters).";
  return null;
}

export function validateMinLength(
  value: string,
  min: number,
  message: string,
): string | null {
  return value.trim().length < min ? message : null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOrderActions(
  orderId: string,
  onRefresh: () => Promise<void>,
) {
  // ── Modal ────────────────────────────────────────────────────────────────
  const [activeModal, setActiveModal] = useState<ModalType | null>(null);

  // ── Shared action state ──────────────────────────────────────────────────
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Dispatch wizard ──────────────────────────────────────────────────────
  const [dispatchStep, setDispatchStep] = useState(1);
  const [courierService, setCourierService] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState("");
  const [dispatchPhotos, setDispatchPhotos] = useState<File[]>([]);
  const [dispatchPhotoKeys, setDispatchPhotoKeys] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState(false);

  // ── Confirm delivery ─────────────────────────────────────────────────────
  const [itemAsDescribed, setItemAsDescribed] = useState<"yes" | "no" | null>(
    null,
  );
  const [deliveryIssueType, setDeliveryIssueType] = useState("");
  const [deliveryPhotos, setDeliveryPhotos] = useState<File[]>([]);
  const [deliveryPhotoKeys, setDeliveryPhotoKeys] = useState<string[]>([]);
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [uploadingDeliveryPhotos, setUploadingDeliveryPhotos] = useState(false);

  // ── Dispute / seller response ────────────────────────────────────────────
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [disputePhotos, setDisputePhotos] = useState<File[]>([]);
  const [sellerResponseText, setSellerResponseText] = useState("");

  // ── Interaction forms ────────────────────────────────────────────────────
  const [cancelRequestReason, setCancelRequestReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnType, setReturnType] = useState("damaged");
  const [returnResolution, setReturnResolution] = useState("full_refund");
  const [partialRefundReason, setPartialRefundReason] = useState("");
  const [partialRefundAmount, setPartialRefundAmount] = useState("");
  const [delayReason, setDelayReason] = useState("");
  const [newEstimatedDate, setNewEstimatedDate] = useState("");

  // ── Counter-evidence ─────────────────────────────────────────────────────
  const [counterDescription, setCounterDescription] = useState("");
  const [counterPhotos, setCounterPhotos] = useState<File[]>([]);
  const [counterPhotoKeys, setCounterPhotoKeys] = useState<string[]>([]);
  const [uploadingCounter, setUploadingCounter] = useState(false);
  const [submittingCounter, setSubmittingCounter] = useState(false);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function openModal(modal: ModalType) {
    setError(null);
    setActiveModal(modal);
  }

  function closeModal() {
    setActiveModal(null);
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

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
    const validationError = validateDispatch({
      courierService,
      trackingNumber,
      estimatedDeliveryDate,
      dispatchPhotoKeys,
    });
    if (validationError) {
      setError(validationError);
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
      await onRefresh();
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
    const validationError = validateConfirmDelivery({
      itemAsDescribed,
      deliveryIssueType,
    });
    if (validationError) {
      setError(validationError);
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
      closeModal();
      await onRefresh();
    } else {
      setError(result.error);
    }
    setActionLoading(false);
  }

  async function handleOpenDispute() {
    const validationError = validateDispute({
      disputeReason,
      disputeDescription,
    });
    if (validationError) {
      setError(validationError);
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
        closeModal();
        await onRefresh();
      } else {
        setError(result.error);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSellerResponse() {
    const validationError = validateMinLength(
      sellerResponseText,
      20,
      "Please provide at least 20 characters in your response.",
    );
    if (validationError) {
      setError(validationError);
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
        closeModal();
        setSellerResponseText("");
        await onRefresh();
      } else {
        setError(result.error);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestCancellation() {
    const validationError = validateMinLength(
      cancelRequestReason,
      10,
      "Please provide a reason (at least 10 characters).",
    );
    if (validationError) {
      setError(validationError);
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
        closeModal();
        setCancelRequestReason("");
        setActionSuccess(
          result.data.autoApproved
            ? "Order cancelled and refund initiated (free cancellation window)."
            : "Cancellation request sent. The other party has 48 hours to respond.",
        );
        await onRefresh();
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
        await onRefresh();
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
        await onRefresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestReturn() {
    const validationError = validateMinLength(
      returnReason,
      10,
      "Please provide a reason (at least 10 characters).",
    );
    if (validationError) {
      setError(validationError);
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
        closeModal();
        setReturnReason("");
        setActionSuccess(
          "Return request sent. The seller has 72 hours to respond.",
        );
        await onRefresh();
      } else {
        setError(result.error);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestPartialRefund() {
    const reasonError = validateMinLength(
      partialRefundReason,
      10,
      "Please provide a reason (at least 10 characters).",
    );
    if (reasonError) {
      setError(reasonError);
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
        closeModal();
        setPartialRefundReason("");
        setPartialRefundAmount("");
        setActionSuccess(
          "Partial refund request sent. The other party has 48 hours to respond.",
        );
        await onRefresh();
      } else {
        setError(result.error);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleNotifyShippingDelay() {
    const validationError = validateMinLength(
      delayReason,
      10,
      "Please provide a reason (at least 10 characters).",
    );
    if (validationError) {
      setError(validationError);
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
        closeModal();
        setDelayReason("");
        setNewEstimatedDate("");
        setActionSuccess("Shipping delay notification sent to the buyer.");
        await onRefresh();
      } else {
        setError(result.error);
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
    const validationError = validateMinLength(
      counterDescription,
      10,
      "Please describe your evidence (at least 10 characters).",
    );
    if (validationError) {
      setError(validationError);
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
      closeModal();
      setCounterDescription("");
      setCounterPhotos([]);
      setCounterPhotoKeys([]);
      await onRefresh();
    } else {
      setError(res.error);
    }
    setSubmittingCounter(false);
  }

  function handleRemoveDispatchPhoto(index: number) {
    setDispatchPhotos((p) => p.filter((_, i) => i !== index));
    setDispatchPhotoKeys((k) => k.filter((_, i) => i !== index));
  }

  function handleRemoveDeliveryPhoto(index: number) {
    setDeliveryPhotos((p) => p.filter((_, i) => i !== index));
    setDeliveryPhotoKeys((k) => k.filter((_, i) => i !== index));
  }

  function handleRemoveCounterPhoto(index: number) {
    setCounterPhotos((p) => p.filter((_, i) => i !== index));
    setCounterPhotoKeys((k) => k.filter((_, i) => i !== index));
  }

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    // Modal
    activeModal,
    openModal,
    closeModal,

    // Shared action state
    actionLoading,
    actionSuccess,
    error,
    setError,

    // Dispatch wizard
    dispatchStep,
    setDispatchStep,
    courierService,
    setCourierService,
    trackingNumber,
    setTrackingNumber,
    trackingUrl,
    setTrackingUrl,
    estimatedDeliveryDate,
    setEstimatedDeliveryDate,
    dispatchPhotos,
    dispatchPhotoKeys,
    uploadingPhotos,
    dispatchSuccess,

    // Confirm delivery
    itemAsDescribed,
    setItemAsDescribed,
    deliveryIssueType,
    setDeliveryIssueType,
    deliveryPhotos,
    deliveryPhotoKeys,
    uploadingDeliveryPhotos,
    deliveryNotes,
    setDeliveryNotes,

    // Dispute / seller response
    disputeReason,
    setDisputeReason,
    disputeDescription,
    setDisputeDescription,
    disputePhotos,
    setDisputePhotos,
    sellerResponseText,
    setSellerResponseText,

    // Interaction forms
    cancelRequestReason,
    setCancelRequestReason,
    rejectNote,
    setRejectNote,
    returnReason,
    setReturnReason,
    returnType,
    setReturnType,
    returnResolution,
    setReturnResolution,
    partialRefundReason,
    setPartialRefundReason,
    partialRefundAmount,
    setPartialRefundAmount,
    delayReason,
    setDelayReason,
    newEstimatedDate,
    setNewEstimatedDate,

    // Counter-evidence
    counterDescription,
    setCounterDescription,
    counterPhotos,
    counterPhotoKeys,
    uploadingCounter,
    submittingCounter,

    // Handlers
    handleUploadDispatchPhotos,
    handleDispatch,
    handleUploadDeliveryPhotos,
    handleConfirmDelivery,
    handleOpenDispute,
    handleSellerResponse,
    handleRequestCancellation,
    handleRespondToCancellation,
    handleRespondToInteraction,
    handleRequestReturn,
    handleRequestPartialRefund,
    handleNotifyShippingDelay,
    handleUploadCounterPhotos,
    handleSubmitCounterEvidence,
    handleRemoveDispatchPhoto,
    handleRemoveDeliveryPhoto,
    handleRemoveCounterPhoto,
  };
}
