// src/lib/pusher.ts  (Sprint 4)
// ─── Server-side Pusher Client ───────────────────────────────────────────────
// Used in server actions to emit real-time events to connected clients.
// Private channels (private-user-{userId}) require authentication via
// /api/pusher/auth endpoint.

import Pusher from "pusher";
import { env } from "@/env";

let _pusherServer: Pusher | null = null;

export function getPusherServer(): Pusher {
  if (!_pusherServer) {
    _pusherServer = new Pusher({
      appId: env.PUSHER_APP_ID,
      key: env.PUSHER_KEY,
      secret: env.PUSHER_SECRET,
      cluster: env.PUSHER_CLUSTER,
      useTLS: true,
    });
  }
  return _pusherServer;
}

export const pusherServer = getPusherServer();
