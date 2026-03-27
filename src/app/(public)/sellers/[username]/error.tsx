'use client';

import Link from 'next/link';

export default function SellerProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center p-4">
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
        <h1
          className="font-[family-name:var(--font-playfair)] text-[1.5rem]
            font-semibold text-[#141414] mb-2"
        >
          Something went wrong
        </h1>
        <p className="text-[13.5px] text-[#73706A] leading-relaxed mb-6">
          We couldn&apos;t load this seller profile. This might be a temporary
          issue — please try again.
        </p>
        {error.digest && (
          <p className="text-[11px] text-[#C9C5BC] mb-4">
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
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
