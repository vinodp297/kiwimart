// src/app/(protected)/layout.tsx
// ─── Protected Route Group Layout ────────────────────────────────────────────
// Applies to: /dashboard/buyer, /dashboard/seller, /account/*
//
// Sprint 3: Replace the mock session check with Auth.js server session:
//
//   import { getServerSession } from 'next-auth';
//   import { authOptions } from '@/lib/auth';
//   import { redirect } from 'next/navigation';
//
//   const session = await getServerSession(authOptions);
//   if (!session?.user) redirect('/login?from=' + encodeURIComponent(/* request path */));
//
// The middleware.ts file provides an additional edge-level guard. This layout
// adds a second server-side check as defence-in-depth.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s | KiwiMart',
    default: 'My Account | KiwiMart',
  },
  // Dashboard pages must not be indexed
  robots: { index: false, follow: false },
};

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Sprint 3: session guard goes here (see comment above)
  return <>{children}</>;
}

