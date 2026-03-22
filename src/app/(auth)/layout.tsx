// src/app/(auth)/layout.tsx
// ─── Auth Route Group Layout ──────────────────────────────────────────────────
// Applies to: /login, /register, /forgot-password, /reset-password
// Sprint 3: add middleware redirect — if session exists, redirect to /dashboard/buyer
// This layout intentionally has NO NavBar / Footer for a focused auth experience.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s | KiwiMart',
    default: 'KiwiMart — New Zealand\'s Trusted Marketplace',
  },
  // Auth pages must not be indexed by search engines
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

