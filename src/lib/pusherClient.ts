"use client";
// src/lib/pusherClient.ts  (Sprint 4)
// ─── Client-side Pusher Instance (Singleton) ─────────────────────────────────
// Used in client components to subscribe to real-time channels.
// Private channels are authenticated via /api/pusher/auth endpoint.

import PusherClient from "pusher-js";
import { env } from "@/env";

let _pusherClient: PusherClient | null = null;

export function getPusherClient(): PusherClient {
  if (!_pusherClient) {
    _pusherClient = new PusherClient(env.NEXT_PUBLIC_PUSHER_KEY, {
      cluster: env.NEXT_PUBLIC_PUSHER_CLUSTER,
      authEndpoint: "/api/pusher/auth",
      authTransport: "ajax",
      auth: {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    });
  }
  return _pusherClient;
}
