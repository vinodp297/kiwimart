// src/components/badges/VerifiedPurchaseBadge.tsx
// ─── Verified Purchase Badge ──────────────────────────────────────────────────
// Displayed on reviews where the reviewer completed a real purchase (orderId present).
// The orderId value itself is never exposed — only its presence triggers this badge.

export interface VerifiedPurchaseBadgeProps {
  size?: "sm" | "md";
}

export function VerifiedPurchaseBadge({
  size = "sm",
}: VerifiedPurchaseBadgeProps) {
  const iconSize = size === "md" ? 14 : 12;
  const textClass = size === "md" ? "text-[12.5px]" : "text-[11px]";

  return (
    <div className="group relative inline-flex items-center">
      <span
        className={`inline-flex items-center gap-1 ${textClass} font-medium text-emerald-600`}
        role="img"
        aria-label="Verified purchase — this reviewer purchased this item on Buyzi"
      >
        <svg
          aria-hidden="true"
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <path d="M22 4L12 14.01l-3-3" />
        </svg>
        Verified purchase
      </span>
      {/* Tooltip */}
      <div
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          w-52 rounded-xl bg-[#141414] text-white text-[11px] leading-relaxed
          px-3 py-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity
          duration-150 z-20 text-center whitespace-normal"
        role="tooltip"
      >
        This reviewer purchased this item on Buyzi
        <span
          className="absolute top-full left-1/2 -translate-x-1/2
            border-4 border-transparent border-t-[#141414]"
        />
      </div>
    </div>
  );
}

export default VerifiedPurchaseBadge;
