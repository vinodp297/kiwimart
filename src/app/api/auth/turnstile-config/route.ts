// src/app/api/auth/turnstile-config/route.ts
// ─── Runtime Turnstile Site Key ─────────────────────────────────────────────
// Returns the Turnstile site key at RUNTIME, not build time.
// This avoids the NEXT_PUBLIC_ build-time baking issue where the key is
// empty if the env var wasn't set during `next build`.
//
// The site key is NOT secret — it's designed to be public (embedded in HTML).
// The SECRET key is never exposed here.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // Read from the non-NEXT_PUBLIC server env var (available at runtime)
  // Fall back to NEXT_PUBLIC_ in case only that one is set
  const siteKey =
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY ??
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??
    "";

  const isActive =
    siteKey.length > 0 &&
    !siteKey.startsWith("1x") &&
    !siteKey.startsWith("2x");

  return NextResponse.json(
    { siteKey: isActive ? siteKey : null, active: isActive },
    {
      headers: {
        // Cache for 1 hour — key doesn't change often
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    },
  );
}
