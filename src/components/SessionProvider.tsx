'use client';
// src/components/SessionProvider.tsx
// ─── Auth.js Session Provider ─────────────────────────────────────────────────
// Wraps Auth.js SessionProvider so client components can call useSession().
// Kept in a dedicated file to avoid making the root layout a client component.
// Mounted in src/app/layout.tsx as the outermost client wrapper.
//
// session prop: pre-fetched server session passed from layout.tsx via auth().
// This prevents the client from making a redundant /api/auth/session fetch on
// initial load, which eliminates the ClientFetchError in development.

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';

export default function SessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <NextAuthSessionProvider session={session} refetchOnWindowFocus={false}>
      {children}
    </NextAuthSessionProvider>
  );
}

