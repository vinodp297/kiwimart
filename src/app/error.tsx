'use client';
// src/app/error.tsx
// ─── Global Error Boundary ────────────────────────────────────────────────────
// Next.js App Router convention: must be 'use client', receives error + reset.
// Sprint 3: wire error.digest to Sentry.captureException(error) before render.

import { useEffect } from 'react';
import Link from 'next/link';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    // Sprint 3: Sentry.captureException(error)
    console.error('[KiwiMart] Unhandled error:', error);
  }, [error]);

  return (
    <div className="bg-[#FAFAF8] min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
          {/* Icon */}
          <div
            className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center
              mx-auto mb-6"
            aria-hidden
          >
            <svg
              width="32" height="32" viewBox="0 0 24 24" fill="none"
              stroke="#dc2626" strokeWidth="1.8"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>

          <h1
            className="font-serif text-[1.75rem] font-semibold text-[#141414]
              mb-2 leading-tight"
          >
            Something went wrong
          </h1>
          <p className="text-[14px] text-[#73706A] leading-relaxed mb-2">
            We&apos;ve logged this error and our team will investigate. Sorry for
            the inconvenience.
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
              href="/"
              className="inline-flex items-center justify-center h-11 px-7 rounded-full
                bg-white text-[#141414] font-semibold text-[14px] border
                border-[#C9C5BC] hover:border-[#141414] transition-colors duration-200"
            >
              Go home
            </Link>
          </div>
      </div>
    </div>
  );
}

