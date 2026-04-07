"use client";
// src/components/ErrorBoundary.tsx
// ─── Inline Error Boundary ─────────────────────────────────────────────────────
// React error boundaries must be class components (hooks cannot catch render
// errors). This component wraps any subtree and shows a friendly fallback when
// a child throws during render, in a lifecycle method, or in a constructor.
//
// Usage:
//   <ErrorBoundary message="Reviews unavailable">
//     <ReviewsSection />
//   </ErrorBoundary>
//
// For route-level errors (page-wide) use the route-segment error.tsx files,
// which delegate to RouteError. This component is for granular section-level
// error containment within a page.

import React from "react";
import { useRouter } from "next/navigation";

// ─── Inner fallback (functional so it can use hooks) ─────────────────────────

function DefaultFallback({
  error,
  resetBoundary,
  message,
}: {
  error: Error;
  resetBoundary: () => void;
  message?: string;
}) {
  const router = useRouter();
  const isDev = process.env.NODE_ENV === "development";

  function handleTryAgain() {
    router.refresh();
    resetBoundary();
  }

  return (
    <div
      className="rounded-2xl border border-[#E3E0D9] bg-white p-8 text-center"
      role="alert"
    >
      {/* Amber warning icon — matches RouteError.tsx style */}
      <div
        className="w-12 h-12 rounded-full bg-amber-50 flex items-center
          justify-center mx-auto mb-4"
        aria-hidden
      >
        <svg
          width="22"
          height="22"
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

      <h3
        className="font-[family-name:var(--font-playfair)] text-[1.05rem]
          font-semibold text-[#141414] mb-2"
      >
        {message ?? "This section couldn't load"}
      </h3>
      <p className="text-[13px] text-[#73706A] leading-relaxed mb-5">
        You can try refreshing or continue browsing the rest of the page.
      </p>

      {/* Dev-only error details — never shown in production */}
      {isDev && (
        <details className="text-left mb-5 text-[12px] text-[#73706A] bg-[#F8F7F4] rounded-xl p-3">
          <summary className="cursor-pointer font-medium text-[#141414]">
            Error details (dev only)
          </summary>
          <p className="mt-2 font-mono break-all text-red-600">
            {error.message}
          </p>
          {error.stack && (
            <pre className="mt-1 text-[11px] text-[#9E9A91] overflow-auto max-h-40 whitespace-pre-wrap">
              {error.stack}
            </pre>
          )}
        </details>
      )}

      <div className="flex gap-3 justify-center">
        <button
          onClick={handleTryAgain}
          className="h-9 px-5 rounded-xl bg-[#D4A843] text-[#141414]
            font-semibold text-[13px] hover:bg-[#B8912E] hover:text-white
            transition-colors"
        >
          Try again
        </button>
        <button
          onClick={() => router.back()}
          className="h-9 px-5 rounded-xl border border-[#E3E0D9]
            text-[#141414] font-semibold text-[13px]
            hover:bg-[#F8F7F4] transition-colors"
        >
          Go back
        </button>
      </div>
    </div>
  );
}

// ─── Props & State ────────────────────────────────────────────────────────────

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback node — overrides the default fallback UI entirely. */
  fallback?: React.ReactNode;
  /** Heading shown in the default fallback (e.g. "Reviews unavailable"). */
  message?: string;
  /** Called when an error is caught — use for Sentry reporting. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ─── Class component ─────────────────────────────────────────────────────────

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  resetBoundary = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return (
        <DefaultFallback
          error={this.state.error!}
          resetBoundary={this.resetBoundary}
          message={this.props.message}
        />
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
