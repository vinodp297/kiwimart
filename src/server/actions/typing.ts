'use server';
// src/server/actions/typing.ts  (Sprint 4)
// ─── Typing Indicator ────────────────────────────────────────────────────────
// Emits a Pusher event when a user is typing in a message thread.
// Debounced on the client side (500ms) to reduce event volume.

import { requireUser } from '@/server/lib/requireUser';
import { getPusherServer } from '@/lib/pusher';

export async function triggerTyping(params: {
  recipientId: string;
  threadId: string;
}): Promise<void> {
  try {
    const user = await requireUser();

    // Don't trigger typing to yourself
    if (params.recipientId === user.id) return;

    const pusher = getPusherServer();
    await pusher.trigger(
      `private-user-${params.recipientId}`,
      'typing',
      {
        threadId: params.threadId,
        userId: user.id,
        userName: user.email.split('@')[0],
      }
    );
  } catch {
    // Silently fail — typing indicators are non-critical
  }
}
