"use client";
// src/components/OrderTimeline.tsx
// ─── Dynamic Order Timeline ─────────────────────────────────────────────────
// Renders a vertical timeline of OrderEvent records. Replaces the old static
// 5-step horizontal stepper with a full event history.

// ── Types ───────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  id: string;
  type: string;
  actorRole: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { displayName: string | null; username: string } | null;
}

interface Props {
  events: TimelineEvent[];
  currentStatus: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
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

type DotColor = "green" | "amber" | "red" | "blue" | "gray";

const EVENT_COLORS: Record<string, DotColor> = {
  ORDER_CREATED: "green",
  PAYMENT_HELD: "green",
  PAYMENT_CAPTURED: "green",
  DISPATCHED: "green",
  DELIVERED: "green",
  COMPLETED: "green",
  DISPUTE_OPENED: "amber",
  CANCEL_REQUESTED: "amber",
  SHIPPING_DELAY_NOTIFIED: "amber",
  CANCELLED: "red",
  REFUNDED: "red",
  REVIEW_SUBMITTED: "blue",
  DISPUTE_RESPONDED: "blue",
  DISPUTE_RESOLVED: "blue",
};

const DOT_STYLES: Record<DotColor, { bg: string; ring: string }> = {
  green: { bg: "bg-emerald-500", ring: "ring-emerald-100" },
  amber: { bg: "bg-amber-500", ring: "ring-amber-100" },
  red: { bg: "bg-red-500", ring: "ring-red-100" },
  blue: { bg: "bg-sky-500", ring: "ring-sky-100" },
  gray: { bg: "bg-[#C9C5BC]", ring: "ring-[#F0EDE8]" },
};

const ROLE_LABELS: Record<string, string> = {
  BUYER: "Buyer",
  SELLER: "Seller",
  ADMIN: "Admin",
  SYSTEM: "System",
};

// ── Component ───────────────────────────────────────────────────────────────

export default function OrderTimeline({ events, currentStatus }: Props) {
  if (events.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 mb-6">
        <p className="text-[13px] text-[#9E9A91]">No timeline events yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 mb-6">
      <h2 className="text-[13.5px] font-semibold text-[#141414] mb-5">
        Order timeline
      </h2>

      <div className="relative">
        {events.map((event, idx) => {
          const isLast = idx === events.length - 1;
          const color = EVENT_COLORS[event.type] ?? "gray";
          const dot = DOT_STYLES[color];
          const meta = event.metadata ?? {};

          return (
            <div key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
              {/* Connector line */}
              {!isLast && (
                <div
                  className="absolute left-[9px] top-5 bottom-0 w-0.5 bg-[#E3E0D9]"
                  aria-hidden
                />
              )}

              {/* Dot */}
              <div className="relative shrink-0 mt-0.5">
                <div
                  className={`rounded-full flex items-center justify-center ${dot.bg} ${
                    isLast
                      ? `w-[22px] h-[22px] ring-4 ${dot.ring}`
                      : "w-[18px] h-[18px]"
                  }`}
                >
                  {isLast ? (
                    <EventIcon type={event.type} size={11} />
                  ) : (
                    <EventIcon type={event.type} size={9} />
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 -mt-0.5">
                {/* Summary */}
                <p
                  className={`leading-snug ${
                    isLast
                      ? "text-[13.5px] font-semibold text-[#141414]"
                      : "text-[12.5px] text-[#141414]"
                  }`}
                >
                  {event.summary}
                </p>

                {/* Metadata details */}
                {!!meta.trackingNumber && (
                  <p className="mt-1 text-[12px] text-[#73706A]">
                    Tracking:{" "}
                    {meta.trackingUrl ? (
                      <a
                        href={String(meta.trackingUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#D4A843] hover:underline font-medium"
                      >
                        {String(meta.trackingNumber)}
                      </a>
                    ) : (
                      <span className="font-medium">
                        {String(meta.trackingNumber)}
                      </span>
                    )}
                  </p>
                )}

                {!!meta.reason && (
                  <p className="mt-1 text-[12px] text-[#73706A] italic">
                    Reason:{" "}
                    {String(meta.reason).replace(/_/g, " ").toLowerCase()}
                  </p>
                )}

                {!!meta.description && (
                  <p className="mt-1 text-[12px] text-[#73706A] line-clamp-3">
                    {String(meta.description)}
                  </p>
                )}

                {!!meta.resolution && (
                  <p className="mt-1 text-[12px] text-[#73706A]">
                    Resolution:{" "}
                    <span className="font-medium">
                      {String(meta.resolution).replace(/_/g, " ").toLowerCase()}
                    </span>
                  </p>
                )}

                {meta.rating != null && (
                  <p className="mt-1 text-[12px] text-[#73706A]">
                    {"★".repeat(Number(meta.rating))}
                    {"☆".repeat(5 - Number(meta.rating))}
                  </p>
                )}

                {/* Timestamp + actor */}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[11px] text-[#9E9A91]">
                    {fmtDate(event.createdAt)}
                  </span>
                  <span className="text-[11px] text-[#C9C5BC]">·</span>
                  <span className="text-[10.5px] text-[#9E9A91] font-medium">
                    {ROLE_LABELS[event.actorRole] ?? event.actorRole}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Event Icons ─────────────────────────────────────────────────────────────

function EventIcon({ type, size }: { type: string; size: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "white",
    strokeWidth: 3,
  };

  switch (type) {
    case "COMPLETED":
    case "PAYMENT_HELD":
    case "PAYMENT_CAPTURED":
    case "DELIVERED":
      return (
        <svg {...common}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "DISPATCHED":
      return (
        <svg {...common}>
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      );
    case "CANCELLED":
    case "REFUNDED":
      return (
        <svg {...common}>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    case "DISPUTE_OPENED":
      return (
        <svg {...common}>
          <path d="M12 9v4M12 17h.01" />
          <circle cx="12" cy="12" r="10" strokeWidth={2} />
        </svg>
      );
    case "REVIEW_SUBMITTED":
      return (
        <svg {...common}>
          <polygon
            points="12 2 15 9 22 9 17 14 18 21 12 17 6 21 7 14 2 9 9 9"
            strokeWidth={2}
          />
        </svg>
      );
    default:
      // Simple filled circle for generic events
      return (
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 8 8">
          <circle cx="4" cy="4" r="3" fill="white" />
        </svg>
      );
  }
}
