'use client';
// src/lib/pusherClient.ts  (Sprint 4)
// ─── Client-side Pusher Instance (Singleton) ─────────────────────────────────
// Used in client components to subscribe to real-time channels.
// Private channels are authenticated via /api/pusher/auth endpoint.

import PusherClient from 'pusher-js';

let _pusherClient: PusherClient | null = null;

export function getPusherClient(): PusherClient {
  if (!_pusherClient) {
    _pusherClient = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY!,
      {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
        authEndpoint: '/api/pusher/auth',
        authTransport: 'ajax',
        auth: {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      }
    );
  }
  return _pusherClient;
}
