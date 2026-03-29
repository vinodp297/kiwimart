// src/app/api/pusher/auth/route.ts  (Sprint 4)
// ─── Pusher Private Channel Authentication ───────────────────────────────────
// Verifies user session before authorising private channels.
// Only allows users to subscribe to their own channel: private-user-{userId}
//
// Security:
//   • Session must be valid (Auth.js JWT)
//   • Channel name must match authenticated user's ID
//   • Prevents subscribing to other users' private channels

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getPusherServer } from "@/lib/pusher";
import { logger } from "@/shared/logger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate — verify session
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorised" },
        { status: 403 },
      );
    }

    // 2. Parse Pusher auth params from form body
    const formData = await request.formData();
    const socketId = formData.get("socket_id") as string;
    const channelName = formData.get("channel_name") as string;

    if (!socketId || !channelName) {
      return NextResponse.json(
        { success: false, error: "Missing socket_id or channel_name" },
        { status: 400 },
      );
    }

    // 3. Authorise — only allow subscribing to own private channel
    const expectedChannel = `private-user-${session.user.id}`;
    if (channelName !== expectedChannel) {
      return NextResponse.json(
        { success: false, error: "Cannot subscribe to another user's channel" },
        { status: 403 },
      );
    }

    // 4. Generate Pusher auth response
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
