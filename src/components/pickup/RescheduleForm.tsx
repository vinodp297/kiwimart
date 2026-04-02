"use client";

// src/components/pickup/RescheduleForm.tsx
// ─── Reschedule Request Form ────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/primitives";

const SELLER_REASONS = [
  { value: "ITEM_NOT_READY", label: "Item not ready for collection" },
  { value: "UNAVAILABLE_AT_AGREED_TIME", label: "Unavailable at agreed time" },
  { value: "LOCATION_OR_ADDRESS_ISSUE", label: "Location or address issue" },
  {
    value: "FAMILY_OR_PERSONAL_EMERGENCY",
    label: "Family or personal emergency",
  },
  { value: "OTHER", label: "Other" },
];

const BUYER_REASONS = [
  { value: "UNAVAILABLE_AT_AGREED_TIME", label: "Unavailable at agreed time" },
  { value: "TRANSPORT_OR_TRAVEL_ISSUE", label: "Transport or travel issue" },
  { value: "CHANGED_PICKUP_LOCATION", label: "Changed pickup location" },
  {
    value: "FAMILY_OR_PERSONAL_EMERGENCY",
    label: "Family or personal emergency",
  },
  { value: "OTHER", label: "Other" },
];

interface RescheduleFormProps {
  orderId: string;
  userRole: "BUYER" | "SELLER";
  onSuccess: () => void;
}

export function RescheduleForm({
  orderId,
  userRole,
  onSuccess,
}: RescheduleFormProps) {
  const [reason, setReason] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasons = userRole === "SELLER" ? SELLER_REASONS : BUYER_REASONS;

  const handleSubmit = useCallback(async () => {
    if (!reason) {
      setError("Please select a reason.");
      return;
    }
    if (reason === "OTHER" && reasonNote.trim().length < 20) {
      setError("Please provide a genuine reason (at least 20 characters).");
      return;
    }
    if (!date || !time) {
      setError("Please select a date and time.");
      return;
    }

    const proposedTime = new Date(`${date}T${time}`);
    if (isNaN(proposedTime.getTime())) {
      setError("Invalid date/time.");
      return;
    }

    const twoHoursFromNow = Date.now() + 2 * 60 * 60 * 1000;
    if (proposedTime.getTime() < twoHoursFromNow) {
      setError("Proposed time must be at least 2 hours in the future.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        orderId,
        proposedTime: proposedTime.toISOString(),
        ...(userRole === "SELLER"
          ? { sellerReason: reason }
          : { buyerReason: reason }),
        ...(reason === "OTHER" ? { reasonNote } : {}),
      };

      const res = await fetch("/api/v1/pickup/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.success) {
        onSuccess();
      } else {
        setError(data.error ?? "Failed to submit reschedule request.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [reason, reasonNote, date, time, orderId, userRole, onSuccess]);

  // Min date: today, max: 30 days from now
  const minDate = new Date().toISOString().split("T")[0];
  const maxDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-[#141414]">
        Request Reschedule
      </h4>

      <div>
        <label className="block text-xs font-medium text-[#73706A] mb-1">
          Reason
        </label>
        <select
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          className="w-full h-9 px-3 rounded-lg border border-[#C9C5BC] text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A843]"
        >
          <option value="">Select a reason...</option>
          {reasons.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {reason === "OTHER" && (
        <div>
          <label className="block text-xs font-medium text-[#73706A] mb-1">
            Details (min 20 characters)
          </label>
          <textarea
            value={reasonNote}
            onChange={(e) => {
              setReasonNote(e.target.value);
              setError(null);
            }}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-[#C9C5BC] text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A843] resize-none"
          />
        </div>
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-[#73706A] mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            min={minDate}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-[#C9C5BC] text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A843]"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-[#73706A] mb-1">
            Time
          </label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-[#C9C5BC] text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A843]"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        size="sm"
        variant="primary"
        onClick={handleSubmit}
        loading={loading}
      >
        Request Reschedule
      </Button>
    </div>
  );
}
