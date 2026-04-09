"use client";

// src/components/pickup/RejectItemDialog.tsx
// ─── Reject Item at Pickup Dialog ───────────────────────────────────────────
// Modal dialog for buyer to reject an item during pickup.

import { useState, useCallback, useRef, useEffect } from "react";
import { createEscapeHandler, findFirstFocusable } from "@/lib/a11y";
import { Button } from "@/components/ui/primitives";
import { rejectItemAtPickup } from "@/server/actions/pickup.actions";

type RejectReason =
  | "ITEM_NOT_AS_DESCRIBED"
  | "ITEM_DAMAGED"
  | "ITEM_NOT_PRESENT"
  | "SIGNIFICANTLY_DIFFERENT"
  | "OTHER";

const REASON_OPTIONS: { value: RejectReason; label: string }[] = [
  { value: "ITEM_NOT_AS_DESCRIBED", label: "Item not as described" },
  { value: "ITEM_DAMAGED", label: "Item is damaged" },
  {
    value: "ITEM_NOT_PRESENT",
    label: "Item not present / seller didn't bring it",
  },
  {
    value: "SIGNIFICANTLY_DIFFERENT",
    label: "Item significantly different from photos",
  },
  { value: "OTHER", label: "Other" },
];

interface RejectItemDialogProps {
  orderId: string;
  listingTitle: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function RejectItemDialog({
  orderId,
  listingTitle,
  onSuccess,
  onCancel,
}: RejectItemDialogProps) {
  const [reason, setReason] = useState<RejectReason | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Escape key closes the dialog
  useEffect(() => {
    const handler = createEscapeHandler(onCancel);
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  // Move focus to the first interactive element when the dialog opens
  useEffect(() => {
    findFirstFocusable(containerRef.current)?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!reason) {
      setError("Please select a reason.");
      return;
    }

    if (reason === "OTHER" && reasonNote.trim().length < 20) {
      setError("Please provide a genuine reason (at least 20 characters).");
      return;
    }

    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await rejectItemAtPickup(orderId, {
        reason,
        reasonNote: reasonNote || undefined,
      });
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error ?? "Failed to reject item.");
        setShowConfirm(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setShowConfirm(false);
    } finally {
      setLoading(false);
    }
  }, [reason, reasonNote, showConfirm, orderId, onSuccess]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={containerRef}
        className="bg-white rounded-2xl border border-[#E3E0D9] p-6 w-full max-w-md mx-4 shadow-xl"
      >
        <div className="flex items-center gap-2 mb-1">
          <span aria-hidden="true" className="text-xl">
            ⚠️
          </span>
          <h2
            id="reject-dialog-title"
            className="text-lg font-bold text-[#141414]"
          >
            Reject this item?
          </h2>
        </div>
        <p className="text-sm text-[#73706A] mb-4">
          Only reject if the item is significantly different from the listing.
          This will open a dispute.
        </p>

        {!showConfirm ? (
          <>
            <label className="block text-sm font-medium text-[#141414] mb-1">
              Reason <span className="text-red-500">*</span>
            </label>
            <select
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as RejectReason);
                setError(null);
              }}
              className="w-full h-10 px-3 rounded-lg border border-[#C9C5BC] text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
            >
              <option value="">Select a reason...</option>
              {REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {reason === "OTHER" && (
              <>
                <label className="block text-sm font-medium text-[#141414] mb-1">
                  Details <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reasonNote}
                  onChange={(e) => {
                    setReasonNote(e.target.value);
                    setError(null);
                  }}
                  rows={3}
                  placeholder="Please explain in detail (min 20 characters)..."
                  className="w-full px-3 py-2 rounded-lg border border-[#C9C5BC] text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-3 resize-none"
                />
              </>
            )}
          </>
        ) : (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-4">
            <p className="text-sm font-medium text-red-900">
              Are you sure? This cannot be undone.
            </p>
            <p className="text-xs text-red-700 mt-1">
              Rejecting &quot;{listingTitle}&quot; will open a dispute.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (showConfirm) {
                setShowConfirm(false);
              } else {
                onCancel();
              }
            }}
            disabled={loading}
          >
            {showConfirm ? "Go Back" : "Cancel"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={handleSubmit}
            loading={loading}
          >
            {showConfirm ? "Yes, Reject Item" : "Reject Item"}
          </Button>
        </div>
      </div>
    </div>
  );
}
