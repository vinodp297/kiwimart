"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/messages.ts — thin wrapper
// Business logic delegated to MessageService.

import { headers } from "next/headers";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { requireUser } from "@/server/lib/requireUser";
import { messageService } from "@/modules/messaging/message.service";
import { sendMessageSchema } from "@/server/validators";
import { updateSellerResponseMetrics } from "@/modules/sellers/response-metrics.service";
import type { ActionResult } from "@/types";

export async function sendMessage(
  raw: unknown,
): Promise<ActionResult<{ messageId: string; threadId: string }>> {
  try {
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);
    const user = await requireUser();

    const parsed = sendMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid message",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    // Rate limit — 20 messages per minute
    const limit = await rateLimit("message", user.id);
    if (!limit.success) {
      return {
        success: false,
        error: `Sending too quickly. Wait ${limit.retryAfter} seconds.`,
      };
    }

    const result = await messageService.sendMessage(
      parsed.data,
      user.id,
      user.email,
    );

    // Update seller response metrics (fire-and-forget)
    updateSellerResponseMetrics(user.id).catch(() => {});

    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "Your message couldn't be sent. Please check your connection and try again.",
      ),
    };
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

export async function getThreadMessages(
  threadId: string,
  options?: { take?: number; cursor?: string },
) {
  try {
    const user = await requireUser();
    return await messageService.getThreadMessages(threadId, user.id, options);
  } catch {
    return { messages: [], hasMore: false };
  }
}
