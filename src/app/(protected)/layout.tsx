// src/app/(protected)/layout.tsx
// ─── Protected Route Group Layout ────────────────────────────────────────────
// Applies to: /dashboard/buyer, /dashboard/seller, /account/*, /orders/*, etc.
//
// Defence-in-depth: proxy.ts provides the first edge-level guard; this
// layout adds a second server-side check so that even if the proxy is somehow
// bypassed, unauthenticated users are always redirected to /login.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';

// Force every protected page to be dynamically rendered — never statically
// cached.  This works with the Cache-Control: no-store headers set in
// proxy.ts to ensure bfcache cannot serve a stale signed-in snapshot.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: {
    template: '%s | KiwiMart',
    default: 'My Account | KiwiMart',
  },
  // Dashboard pages must not be indexed
  robots: { index: false, follow: false },
};

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    // Preserve the current path so the user lands back here after login
    const reqHeaders = await headers();
    const pathname = reqHeaders.get('x-invoke-path') ?? '/dashboard/buyer';
    redirect(`/login?from=${encodeURIComponent(pathname)}`);
  }

  return <>{children}</>;
}
