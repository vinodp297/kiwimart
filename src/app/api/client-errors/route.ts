// src/app/api/client-errors/route.ts
// ─── Client Error Reporting Endpoint ─────────────────────────────────────────
// Receives browser-side error reports from clientError() in src/lib/client-logger.ts.
// Rate-limited to 10 per minute per IP (fail-open — reporting must never be blocked).
// Validates and forwards to the structured logger for observability.

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/shared/logger";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Rate limit: 10 error reports per minute per IP.
  // Fail-open — the right to report errors should not be blocked.
  const ip = getClientIp(req.headers);
  const limit = await rateLimit("clientErrors", ip);
  if (!limit.success) {
    // Rate limit exceeded — acknowledge silently so the client doesn't retry.
    return NextResponse.json({ ok: true });
  }

  try {
    const body = await req.json();
    const { message, context, url } = body as Record<string, unknown>;

    if (typeof message !== "string" || message.length === 0) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    if (message.length > 500) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    logger.warn("client.error", {
      message: message.slice(0, 500),
      url: typeof url === "string" ? url.slice(0, 200) : undefined,
      context:
        context !== null && typeof context === "object" ? context : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
