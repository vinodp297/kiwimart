'use server';
import { safeActionError } from '@/shared/errors'
// src/server/actions/messages.ts — thin wrapper
// Business logic delegated to MessageService.

import { headers } from 'next/headers';
import { rateLimit, getClientIp } from '@/server/lib/rateLimit';
import { requireUser } from '@/server/lib/requireUser';
import { messageService } from '@/modules/messaging/message.service';
import { sendMessageSchema } from '@/server/validators';
import type { ActionResult } from '@/types';

export async function sendMessage(
  raw: unknown
): Promise<ActionResult<{ messageId: string; threadId: string }>> {
  try {
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);
    const user = await requireUser();

    const parsed = sendMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: 'Invalid message',
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    // Rate limit — 20 messages per minute
    const limit = await rateLimit('message', user.id);
    if (!limit.success) {
      return {
        success: false,
        error: `Sending too quickly. Wait ${limit.retryAfter} seconds.`,
      };
    }

    const result = await messageService.sendMessage(parsed.data, user.id, user.email);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: safeActionError(err) };
  }
}

export async function getMyThreads() {
  try {
    const user = await requireUser();
    return await messageService.getMyThreads(user.id);
  } catch {
    return [];
  }
}

export async function getThreadMessages(threadId: string) {
  try {
    const user = await requireUser();
    return await messageService.getThreadMessages(threadId, user.id);
  } catch {
    return [];
  }
}
