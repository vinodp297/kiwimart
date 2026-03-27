'use client';
// src/components/RouteError.tsx
// ─── Shared Error Boundary Component ─────────────────────────────────────────
// Reusable across all route-level error.tsx files to ensure consistent UX.

import { useEffect } from 'react';
import Link from 'next/link';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[KiwiMart] Route error:', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div
          className="w-16 h-16 rounded-full bg-amber-50 flex items-center
            justify-center mx-auto mb-5"
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
        <h2
          className="font-[family-name:var(--font-playfair)] text-[1.5rem]
            font-semibold text-[#141414] mb-2"
        >
          Something went wrong
        </h2>
        <p className="text-[13.5px] text-[#73706A] leading-relaxed mb-2">
          We&apos;ve logged this error and will investigate.
          Sorry for the inconvenience.
        </p>
        {error.digest && (
          <p className="text-[11px] text-[#C9C5BC] mb-6">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="h-10 px-6 rounded-xl bg-[#D4A843] text-[#141414]
              font-semibold text-[13.5px] hover:bg-[#B8912E] hover:text-white
              transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="h-10 px-6 rounded-xl border border-[#E3E0D9]
              text-[#141414] font-semibold text-[13.5px]
              hover:bg-[#F8F7F4] transition-colors flex items-center"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
