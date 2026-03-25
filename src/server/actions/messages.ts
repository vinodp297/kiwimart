'use server';
// src/server/actions/messages.ts  (Sprint 4 — real-time via Pusher)
// ─── Message Server Actions ───────────────────────────────────────────────────

import { headers } from 'next/headers';
import db from '@/lib/db';
import { rateLimit, getClientIp } from '@/server/lib/rateLimit';
import { requireUser } from '@/server/lib/requireUser';
import { moderateText } from '@/server/lib/moderation';
import { sendMessageSchema } from '@/server/validators';
import type { ActionResult } from '@/types';

// ── sendMessage ───────────────────────────────────────────────────────────────

export async function sendMessage(
  raw: unknown
): Promise<ActionResult<{ messageId: string; threadId: string }>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  // 1. Authenticate + ban check
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Sign in to send messages.' };
  }

  // 3. Validate
  const parsed = sendMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid message',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { threadId, recipientId, listingId, body } = parsed.data;

  // 4. Rate limit — 20 messages per minute
  const limit = await rateLimit('message', user.id);
  if (!limit.success) {
    return {
      success: false,
      error: `Sending too quickly. Wait ${limit.retryAfter} seconds.`,
    };
  }

  // 2. Authorise — cannot message yourself
  if (recipientId === user.id) {
    return { success: false, error: 'Cannot send a message to yourself.' };
  }

  // 5a. Verify recipient exists and is not banned
  const recipient = await db.user.findUnique({
    where: { id: recipientId, isBanned: false, deletedAt: null },
    select: { id: true },
  });
  if (!recipient) {
    return { success: false, error: 'Recipient not found.' };
  }

  // 5b. Find or create thread
  const [p1, p2] = [user.id, recipientId].sort();

  let thread = threadId
    ? await db.messageThread.findUnique({ where: { id: threadId } })
    : await db.messageThread.findFirst({
        where: {
          participant1Id: p1,
          participant2Id: p2,
          listingId: listingId ?? null,
        },
      });

  if (!thread) {
    thread = await db.messageThread.create({
      data: {
        participant1Id: p1,
        participant2Id: p2,
        listingId: listingId ?? null,
      },
    });
  }

  // 5c. Content moderation
  const modResult = await moderateText(body, 'message');
  if (!modResult.allowed) {
    return { success: false, error: modResult.reason ?? 'Message contains prohibited content.' };
  }
  const flagged = modResult.flagged;
  const flagReason: string | null = modResult.flagReason ?? null;

  // 5d. Create message
  const message = await db.message.create({
    data: {
      threadId: thread.id,
      senderId: user.id,
      body,
      flagged,
      flagReason,
    },
    select: { id: true, createdAt: true },
  });

  // 5e. Update thread's lastMessageAt
  await db.messageThread.update({
    where: { id: thread.id },
    data: { lastMessageAt: new Date() },
  });

  // 5f. Emit Pusher event for real-time delivery
  try {
    const { getPusherServer } = await import('@/lib/pusher');
    const pusher = getPusherServer();
    await pusher.trigger(
      `private-user-${recipientId}`,
      'new-message',
      {
        threadId: thread.id,
        messageId: message.id,
        senderId: user.id,
        senderName: user.email.split('@')[0],
        preview: body.slice(0, 100),
        createdAt: message.createdAt.toISOString(),
      }
    );
  } catch {
    // Pusher unavailable — message is still saved to DB
    console.warn('[Messages] Pusher event failed — message saved to DB only');
  }

  return { success: true, data: { messageId: message.id, threadId: thread.id } };
}

// ── getThreads — used in buyer dashboard ─────────────────────────────────────

export async function getMyThreads() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return [];
  }

  const threads = await db.messageThread.findMany({
    where: {
      OR: [
        { participant1Id: user.id },
        { participant2Id: user.id },
      ],
    },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          body: true,
          senderId: true,
          createdAt: true,
          read: true,
        },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
  });

  return threads;
}

// ── getThreadMessages — fetch all messages for a specific thread ─────────────

export async function getThreadMessages(threadId: string) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return [];
  }

  // Verify user is a participant
  const thread = await db.messageThread.findUnique({
    where: { id: threadId },
    select: { participant1Id: true, participant2Id: true },
  });

  if (!thread) return [];
  if (thread.participant1Id !== user.id && thread.participant2Id !== user.id) {
    return [];
  }

  // Mark messages as read
  await db.message.updateMany({
    where: {
      threadId,
      senderId: { not: user.id },
      read: false,
    },
    data: { read: true, readAt: new Date() },
  });

  return db.message.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      body: true,
      senderId: true,
      createdAt: true,
      read: true,
      sender: {
        select: { displayName: true },
      },
    },
  });
}
