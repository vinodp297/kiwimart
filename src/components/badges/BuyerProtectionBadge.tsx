// src/components/badges/BuyerProtectionBadge.tsx
// ─── Buyer Protection Badge ───────────────────────────────────────────────────
// Displays the escrow-backed buyer protection guarantee.
// compact: small pill for listing sidebars
// full:    card with bullet points for checkout / order pages

export interface BuyerProtectionBadgeProps {
  variant?: "compact" | "full";
  /** Protection amount in NZD cents. Defaults to 300000 ($3,000). */
  amountCents?: number;
}

function formatAmount(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

// ── Shield icon (inline SVG — no external dep) ────────────────────────────────
function ShieldIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

// ── Compact variant ───────────────────────────────────────────────────────────

function CompactBadge({ label }: { label: string }) {
  return (
    <div className="group relative inline-flex items-center">
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
          bg-emerald-50 border border-emerald-200 text-emerald-700
          text-[12px] font-semibold cursor-default select-none"
        role="img"
        aria-label={`${label} Buyer Protection — funds held in escrow until you confirm delivery`}
      >
        <ShieldIcon size={13} />
        <span>{label} Buyer Protection</span>
      </div>
      {/* Tooltip */}
      <div
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          w-56 rounded-xl bg-[#141414] text-white text-[11.5px] leading-relaxed
          px-3 py-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity
          duration-150 z-20 text-center"
        role="tooltip"
      >
        Funds held in escrow until you confirm delivery
        {/* Arrow */}
        <span
          className="absolute top-full left-1/2 -translate-x-1/2
            border-4 border-transparent border-t-[#141414]"
        />
      </div>
    </div>
  );
}

// ── Full variant ──────────────────────────────────────────────────────────────

function FullBadge({ label }: { label: string }) {
  return (
    <div
      className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
      role="region"
      aria-label="Buyer protection information"
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
          <ShieldIcon size={18} />
        </div>
        <div>
          <p className="text-[13.5px] font-semibold text-emerald-800">
            {label} Buyer Protection
          </p>
          <p className="text-[11.5px] text-emerald-600">
            Included on every purchase
          </p>
        </div>
      </div>
      <ul className="space-y-1.5" aria-label="Buyer protection details">
        {[
          "Funds held in secure escrow",
          "Full refund if item not as described",
          "Covered by NZ Consumer Guarantees Act",
        ].map((point) => (
          <li
            key={point}
            className="flex items-start gap-2 text-[12px] text-emerald-700"
          >
            <svg
              aria-hidden="true"
              className="shrink-0 mt-0.5"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export function BuyerProtectionBadge({
  variant = "compact",
  amountCents = 300_000,
}: BuyerProtectionBadgeProps) {
  const label = formatAmount(amountCents);
  return variant === "full" ? (
    <FullBadge label={label} />
  ) : (
    <CompactBadge label={label} />
  );
}

export default BuyerProtectionBadge;
