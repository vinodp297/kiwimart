// src/app/api/pusher/auth/route.ts  (Sprint 4)
// ─── Pusher Private Channel Authentication ───────────────────────────────────
// Verifies user session before authorising private channels.
// Only allows users to subscribe to their own channel: private-user-{userId}
//
// Security:
//   • Request origin must match NEXT_PUBLIC_APP_URL (prevents cross-origin abuse)
//   • Session must be valid (Auth.js JWT)
//   • Rate limited: 20 requests per minute per user (prevents connection exhaustion)
//   • Channel name must match authenticated user's ID
//   • Prevents subscribing to other users' private channels

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getPusherServer } from "@/lib/pusher";
import { logger } from "@/shared/logger";
import { rateLimit } from "@/server/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // 0. Origin check — only allow requests from the configured app URL.
    //    This prevents cross-origin attackers from using a victim's session
    //    cookie to open Pusher connections on their behalf.
    const origin = request.headers.get("origin");
    const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL;
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      logger.warn("pusher.auth.origin_rejected", {
        origin,
        expected: allowedOrigin,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 },
      );
    }

    // 1. Authenticate — verify session
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorised" },
        { status: 403 },
      );
    }

    // 2. Rate limit — 20 requests per minute per user.
    //    Keyed by userId so reconnects from multiple tabs share the budget.
    const limit = await rateLimit("pusherAuth", session.user.id);
    if (!limit.success) {
      logger.warn("pusher.auth.rate_limited", { userId: session.user.id });
      return NextResponse.json(
        {
          success: false,
          error: "Too many connection attempts. Please wait a moment.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(limit.retryAfter),
          },
        },
      );
    }

    // 3. Parse Pusher auth params from form body
    const formData = await request.formData();
    const socketId = formData.get("socket_id") as string;
    const channelName = formData.get("channel_name") as string;

    if (!socketId || !channelName) {
      return NextResponse.json(
        { success: false, error: "Missing socket_id or channel_name" },
        { status: 400 },
      );
    }

    // 4. Authorise — only allow subscribing to own private channel
    const expectedChannel = `private-user-${session.user.id}`;
    if (channelName !== expectedChannel) {
      return NextResponse.json(
        { success: false, error: "Cannot subscribe to another user's channel" },
        { status: 403 },
      );
    }

    // 5. Generate Pusher auth response
    const pusher = getPusherServer();
    const authResponse = pusher.authorizeChannel(socketId, channelName);

    return NextResponse.json(authResponse);
  } catch (e) {
    logger.error("api.error", {
      path: "/api/pusher/auth",
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      {
        success: false,
        error: "Real-time connection failed. Please refresh the page.",
      },
      { status: 500 },
    );
  }
}
