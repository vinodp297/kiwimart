'use client';
// src/components/SessionProvider.tsx
// ─── Auth.js Session Provider ─────────────────────────────────────────────────
// Wraps Auth.js SessionProvider so client components can call useSession().
// Kept in a dedicated file to avoid making the root layout a client component.
// Mounted in src/app/layout.tsx as the outermost client wrapper.

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';

export default function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}

