"use client";
// src/components/BfcacheGuard.tsx
// ─── bfcache (back-forward cache) guard ───────────────────────────────────────
// Mounted in the ROOT layout so it covers every page — public and protected.
//
// Two defences:
//
// 1. pageshow listener — fires with event.persisted === true when the browser
//    restores a page from bfcache (back/forward button).  We force a hard
//    reload so the server re-validates the session cookie and either renders
//    the page fresh or redirects to /login.
//
// 2. Session-null redirect — if Auth.js reports status:'unauthenticated'
//    while the user is on a protected path (cookie expired, Redis blocklist
//    hit, etc.) we send them to /login immediately without waiting for a
//    server round-trip.

import { useEffect } from "react";
import { useSessionSafe } from "@/hooks/useSessionSafe";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/account",
  "/orders",
  "/messages",
  "/admin",
  "/seller",
  "/notifications",
  "/reviews",
  "/welcome",
];

export function BfcacheGuard() {
  const { status } = useSessionSafe();

  // ── Defence 1: bfcache reload ──────────────────────────────────────────────
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        window.location.reload();
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  // ── Defence 2: session-null redirect ──────────────────────────────────────
  useEffect(() => {
    if (status === "unauthenticated") {
      const isProtected = PROTECTED_PREFIXES.some((p) =>
        window.location.pathname.startsWith(p),
      );
      if (isProtected) {
        window.location.href = "/login";
      }
    }
  }, [status]);

  return null;
}
