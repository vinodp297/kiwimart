'use client';
// src/components/BfcacheGuard.tsx
// ─── bfcache (back-forward cache) guard ───────────────────────────────────────
// Browsers can restore a full in-memory snapshot of a page from bfcache when
// the user presses Back.  This snapshot bypasses network requests entirely, so
// it can show a signed-in dashboard to a user who already signed out.
//
// The `pageshow` event fires with event.persisted === true when a page is
// restored from bfcache.  We force a hard reload in that case so the server
// can verify the session and redirect to /login if the cookie is gone.
//
// This component renders nothing — it only attaches the event listener.
// It is mounted once in the (protected) layout, covering every protected page.

import { useEffect } from 'react';

export function BfcacheGuard() {
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        // Page was restored from bfcache — force a live network fetch so
        // the server can re-validate the session cookie.
        window.location.reload();
      }
    }

    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  return null;
}
