"use client";

// src/components/pickup/PickupMessageCard.tsx
// ─── Pickup Message Card ────────────────────────────────────────────────────
// Renders structured pickup-related messages as interactive cards
// instead of plain text in the message thread.

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/primitives";

interface PickupMessageCardProps {
  messageBody: string;
  currentUserId: string;
  messageSenderId: string | null;
  orderId: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-NZ", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export function PickupMessageCard({
  messageBody,
  currentUserId,
  messageSenderId,
  orderId,
}: PickupMessageCardProps) {
  const [loading, setLoading] = useState(false);

  let card: Record<string, unknown>;
  try {
    card = JSON.parse(messageBody);
  } catch {
    return <p className="text-sm text-[#73706A]">{messageBody}</p>;
  }

  const type = card.type as string;
  const isOwnMessage = currentUserId === messageSenderId;

  const handleAccept = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/pickup/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (data.success) window.location.reload();
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [orderId]);

  const handleRespondReschedule = useCallback(
    async (response: string) => {
      setLoading(true);
      try {
        const requestId = card.requestId as string;
        const res = await fetch("/api/v1/pickup/reschedule/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId,
            rescheduleRequestId: requestId,
            response,
          }),
        });
        const data = await res.json();
        if (data.success) window.location.reload();
      } catch {
        /* ignore */
      }
      setLoading(false);
    },
    [orderId, card.requestId],
  );

  // ── PICKUP_PROPOSAL ──────────────────────────────────────────────────────
  if (type === "PICKUP_PROPOSAL") {
    const proposedBy = card.proposedBy as string;
    const proposedTime = card.proposedTime as string;
    const location = card.location as string;

    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 max-w-xs">
        <div className="flex items-center gap-2 mb-1">
          <span>📅</span>
          <span className="text-xs font-semibold text-blue-900">
            Pickup Proposed
          </span>
        </div>
        <p className="text-sm font-medium text-blue-800">
          {formatDate(proposedTime)}
        </p>
        <p className="text-xs text-blue-600 mt-0.5">📍 {location}</p>
        <p className="text-xs text-blue-500 mt-1">
          Proposed by {proposedBy === "BUYER" ? "buyer" : "seller"}
        </p>

        {!isOwnMessage && (
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              variant="gold"
              onClick={handleAccept}
              loading={loading}
            >
              Accept
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── PICKUP_CONFIRMED ─────────────────────────────────────────────────────
  if (type === "PICKUP_CONFIRMED") {
    const confirmedTime = card.confirmedTime as string;
    const location = card.location as string;

    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-3 max-w-xs">
        <div className="flex items-center gap-2 mb-1">
          <span>✅</span>
          <span className="text-xs font-semibold text-green-900">
            Pickup Confirmed
          </span>
        </div>
        <p className="text-sm font-bold text-green-800">
          {formatDate(confirmedTime)}
        </p>
        <p className="text-xs text-green-600 mt-0.5">📍 {location}</p>
        <p className="text-xs text-green-500 mt-1">
          Both parties have agreed to this time
        </p>
      </div>
    );
  }

  // ── PICKUP_RESCHEDULE_REQUEST ─────────────────────────────────────────────
  if (type === "PICKUP_RESCHEDULE_REQUEST") {
    const requestedBy = card.requestedBy as string;
    const reason = card.reason as string;
    const reasonNote = card.reasonNote as string | null;
    const proposedTime = card.proposedTime as string;

    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 max-w-xs">
        <div className="flex items-center gap-2 mb-1">
          <span>🔄</span>
          <span className="text-xs font-semibold text-amber-900">
            Reschedule Requested
          </span>
        </div>
        <p className="text-xs text-amber-700">
          {requestedBy === "BUYER" ? "Buyer" : "Seller"} requested a reschedule
        </p>
        <p className="text-xs text-amber-600 mt-1">
          <strong>Reason:</strong> {reason}
        </p>
        {reasonNote && (
          <p className="text-xs text-amber-600 italic mt-0.5">
            &quot;{reasonNote}&quot;
          </p>
        )}
        <p className="text-sm font-medium text-amber-800 mt-1">
          New time: {formatDate(proposedTime)}
        </p>

        {!isOwnMessage && (
          <div className="flex gap-2 mt-2 flex-wrap">
            <Button
              size="sm"
              variant="gold"
              onClick={() => handleRespondReschedule("ACCEPT")}
              loading={loading}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleRespondReschedule("REJECT")}
              loading={loading}
            >
              Decline
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── PICKUP_RESCHEDULE_RESPONSE ────────────────────────────────────────────
  if (type === "PICKUP_RESCHEDULE_RESPONSE") {
    const response = card.response as string;
    const respondedBy = card.respondedBy as string;
    const newTime = card.newTime as string | null;
    const isAccepted = response === "ACCEPTED";

    return (
      <div
        className={`rounded-lg border p-3 max-w-xs ${
          isAccepted
            ? "border-green-200 bg-green-50"
            : "border-red-200 bg-red-50"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span>{isAccepted ? "✅" : "❌"}</span>
          <span
            className={`text-xs font-semibold ${
              isAccepted ? "text-green-900" : "text-red-900"
            }`}
          >
            Reschedule {isAccepted ? "Accepted" : "Declined"}
          </span>
        </div>
        <p
          className={`text-xs ${
            isAccepted ? "text-green-700" : "text-red-700"
          }`}
        >
          {respondedBy === "BUYER" ? "Buyer" : "Seller"}{" "}
          {isAccepted ? "accepted" : "declined"} the reschedule request
        </p>
        {isAccepted && newTime && (
          <p className="text-sm font-medium text-green-800 mt-1">
            New pickup: {formatDate(newTime)}
          </p>
        )}
      </div>
    );
  }

  // Unknown card type — render as plain text
  return <p className="text-sm text-[#73706A]">{messageBody}</p>;
}
