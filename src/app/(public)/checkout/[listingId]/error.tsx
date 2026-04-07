"use client";
// src/app/(public)/checkout/[listingId]/error.tsx
// ─── Checkout Error Boundary ──────────────────────────────────────────────────
// Shown when the checkout page throws. The message reassures the user their
// cart selection is safe — reducing drop-off from recoverable load errors.

import Link from "next/link";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function CheckoutError({ error, reset }: Props) {
  return (
    <div className="bg-[#FAFAF8] min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {/* Amber warning icon */}
        <div
          className="w-16 h-16 rounded-full bg-amber-50 flex items-center
            justify-center mx-auto mb-5"
          aria-hidden
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#d97706"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1
          className="font-[family-name:var(--font-playfair)] text-[1.5rem]
            font-semibold text-[#141414] mb-2 leading-tight"
        >
          Something went wrong with checkout
        </h1>
        <p className="text-[14px] text-[#73706A] leading-relaxed mb-1">
          Your cart has been saved — please try again or contact support.
        </p>
        <p className="text-[13px] text-[#9E9A91] leading-relaxed mb-2">
          No payment has been taken.
        </p>
        {error.digest && (
          <p className="text-[11px] text-[#C9C5BC] font-mono mb-6">
            Error ID: {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 h-11 px-7
              rounded-full bg-[#141414] text-white font-semibold text-[14px]
              hover:bg-[#D4A843] transition-colors duration-200"
          >
            Try again
          </button>
          <Link
            href="/dashboard/buyer"
            className="inline-flex items-center justify-center h-11 px-7
              rounded-full bg-white text-[#141414] font-semibold text-[14px]
              border border-[#C9C5BC] hover:border-[#141414] transition-colors
              duration-200"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
