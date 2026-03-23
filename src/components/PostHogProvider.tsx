'use client';
// src/components/PostHogProvider.tsx
// ─── PostHog Analytics Provider ──────────────────────────────────────────────
// Wraps the app with PostHog analytics. Only sends userId — no PII.
// Disabled when NEXT_PUBLIC_POSTHOG_KEY is not set.

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';

// Initialize PostHog only once, only in browser, only with a key
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_POSTHOG_KEY &&
  !posthog.__loaded
) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    // Privacy: don't capture PII
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    // Respect Do Not Track
    respect_dnt: true,
    // Don't store personal data
    persistence: 'localStorage+cookie',
    // Mask all text inputs
    mask_all_text: true,
    mask_all_element_attributes: false,
  });
}

function PostHogIdentifier() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.user?.id && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      // Only identify with userId — no email, name, or other PII
      posthog.identify(session.user.id);
    } else if (!session?.user && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      posthog.reset();
    }
  }, [session?.user?.id, session?.user]);

  return null;
}

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  // If no PostHog key, just render children without the provider
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return <>{children}</>;
  }

  return (
    <PHProvider client={posthog}>
      <PostHogIdentifier />
      {children}
    </PHProvider>
  );
}
