'use server';
// src/server/actions/typing.ts  (Sprint 4)
// ─── Typing Indicator ────────────────────────────────────────────────────────
// Emits a Pusher event when a user is typing in a message thread.
// Debounced on the client side (500ms) to reduce event volume.

import { auth } from '@/lib/auth';
import { getPusherServer } from '@/lib/pusher';

export async function triggerTyping(params: {
  recipientId: string;
  threadId: string;
}): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  // Don't trigger typing to yourself
  if (params.recipientId === session.user.id) return;

  try {
    const pusher = getPusherServer();
    await pusher.trigger(
      `private-user-${params.recipientId}`,
      'typing',
      {
        threadId: params.threadId,
        userId: session.user.id,
        userName: session.user.name ?? 'Someone',
      }
    );
  } catch {
    // Silently fail — typing indicators are non-critical
  }
}
