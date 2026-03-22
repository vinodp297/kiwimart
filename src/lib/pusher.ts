// src/lib/pusher.ts  (Sprint 4)
// ─── Server-side Pusher Client ───────────────────────────────────────────────
// Used in server actions to emit real-time events to connected clients.
// Private channels (private-user-{userId}) require authentication via
// /api/pusher/auth endpoint.

import Pusher from 'pusher';

let _pusherServer: Pusher | null = null;

export function getPusherServer(): Pusher {
  if (!_pusherServer) {
    _pusherServer = new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER!,
      useTLS: true,
    });
  }
  return _pusherServer;
}

export const pusherServer = getPusherServer();
