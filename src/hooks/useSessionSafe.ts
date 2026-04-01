"use client";
// src/hooks/useSessionSafe.ts
// ─── SSR-safe useSession wrapper ─────────────────────────────────────────────
// Auth.js v5 useSession() throws during SSR when the SessionProvider context
// isn't available (React context unavailable during server-side rendering of
// client components). This wrapper catches that error and returns a "loading"
// state, allowing the component to hydrate normally on the client.

import { useSession } from "next-auth/react";
import type { Session } from "next-auth";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export function useSessionSafe(): {
  data: Session | null;
  status: SessionStatus;
} {
  try {
    return useSession();
  } catch {
    // SSR without SessionProvider context — return loading state so the
    // component renders a safe skeleton. Client hydration will re-render
    // with the real session once the SessionProvider mounts.
    return { data: null, status: "loading" };
  }
}
