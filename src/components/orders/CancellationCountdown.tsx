"use client";
// src/components/orders/CancellationCountdown.tsx
// ─── Cancellation Window Countdown ───────────────────────────────────────────
// Shows a live countdown for the free-cancellation window.
// Ticks every 60 s client-side; switches to 'request' state when the window closes.

import { useState, useEffect } from "react";

export interface CancellationCountdownProps {
  windowType: "free" | "request" | "closed" | "na";
  minutesLeft: number;
  canCancel: boolean;
}

function formatCountdown(minutes: number): string {
  if (minutes <= 0) return "0m";
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

export function CancellationCountdown({
  windowType: initialWindowType,
  minutesLeft: initialMinutesLeft,
  canCancel,
}: CancellationCountdownProps) {
  const [minutesLeft, setMinutesLeft] = useState(initialMinutesLeft);
  const [windowType, setWindowType] = useState(initialWindowType);

  // Tick every 60 s while in free window
  useEffect(() => {
    if (windowType !== "free" || minutesLeft <= 0) return;

    const id = setInterval(() => {
      setMinutesLeft((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          setWindowType("request");
          return 0;
        }
        return next;
      });
    }, 60_000);

    return () => clearInterval(id);
  }, [windowType, minutesLeft]);

  // Nothing to show for non-cancellable orders not in the free window
  if (windowType === "na") return null;

  if (windowType === "closed") {
    return (
      <p className="text-[12px] text-[#9E9A91]" role="status">
        Cancellation window closed
      </p>
    );
  }

  if (windowType === "request") {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
          bg-amber-50 border border-amber-200 text-amber-700 text-[12.5px] font-medium"
        role="status"
        aria-live="polite"
      >
        <svg
          aria-hidden="true"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        Cancellation requires seller approval
      </div>
    );
  }

  // windowType === "free"
  const isUrgent = minutesLeft <= 10;
  const isWarning = minutesLeft < 60 && !isUrgent;

  const colourClasses = isUrgent
    ? "bg-red-50 border-red-200 text-red-700"
    : isWarning
      ? "bg-amber-50 border-amber-200 text-amber-700"
      : "bg-emerald-50 border-emerald-200 text-emerald-700";

  const formatted = formatCountdown(minutesLeft);

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
        border text-[12.5px] font-medium ${colourClasses}
        ${isUrgent ? "animate-pulse" : ""}`}
      role="timer"
      aria-live="polite"
      aria-label={`Free cancellation: ${formatted} remaining`}
    >
      <svg
        aria-hidden="true"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
      {canCancel
        ? `Free cancellation: ${formatted} remaining`
        : `Cancellation window: ${formatted} remaining`}
    </div>
  );
}

export default CancellationCountdown;
