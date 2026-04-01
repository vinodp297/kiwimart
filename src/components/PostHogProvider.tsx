"use client";
// src/components/PostHogProvider.tsx
// ─── PostHog Analytics Provider ──────────────────────────────────────────────
// Wraps the app with PostHog analytics. Only sends userId — no PII.
// Disabled when NEXT_PUBLIC_POSTHOG_KEY is missing or is a placeholder value.

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import { useSessionSafe } from "@/hooks/useSessionSafe";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

// A real PostHog project key always starts with 'phc_' and is never a placeholder.
// Checking this at module scope prevents posthog.init() from firing with a fake key
// (which causes 401/404 network errors that can crash the page JS).
const isConfigured =
  typeof POSTHOG_KEY === "string" &&
  POSTHOG_KEY.startsWith("phc_") &&
  !POSTHOG_KEY.toLowerCase().includes("placeholder");

// Initialize PostHog only once, only in browser, only with a real key
if (typeof window !== "undefined" && isConfigured && !posthog.__loaded) {
  posthog.init(POSTHOG_KEY!, {
    api_host: POSTHOG_HOST,
    // Privacy: don't capture PII
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    // Respect Do Not Track
    respect_dnt: true,
    // Don't store personal data
    persistence: "localStorage+cookie",
    // Mask all text inputs
    mask_all_text: true,
    mask_all_element_attributes: false,
  });
}

function PostHogIdentifier() {
  const { data: session } = useSessionSafe();

  useEffect(() => {
    if (!isConfigured) return;
    if (session?.user?.id) {
      // Only identify with userId — no email, name, or other PII
      posthog.identify(session.user.id);
    } else if (!session?.user) {
      posthog.reset();
    }
  }, [session?.user?.id, session?.user]);

  return null;
}

export default function PostHogProvider({
  children,
  nonce: _nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  // Not configured (missing key or placeholder) — render children without PostHog
  if (!isConfigured) {
    return <>{children}</>;
  }

  return (
    <PHProvider client={posthog}>
      <PostHogIdentifier />
      {children}
    </PHProvider>
  );
}
