// src/modules/messaging/message.service.ts
// ─── Message Service ─────────────────────────────────────────────────────────
// Thread and message operations. Framework-free.

import { messageRepository } from "./message.repository";
import { moderateText } from "@/server/lib/moderation";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import { createNotification } from "@/modules/notifications/notification.service";
import { sendNewMessageEmail } from "@/server/email";
import type { SendMessageInput, SendMessageResult } from "./message.types";

export class MessageService {
  async sendMessage(
    input: SendMessageInput,
    userId: string,
    userEmail: string,
  ): Promise<SendMessageResult> {
    if (input.recipientId === userId) {
      throw AppError.validation("Cannot send a message to yourself.");
    }

    // Verify recipient exists and is not banned
    const recipient = await messageRepository.findActiveUserById(
      input.recipientId,
    );
    if (!recipient) throw AppError.notFound("Recipient");

    // Check if either party has blocked the other
    const block = await messageRepository.findBlock(userId, input.recipientId);
    if (block) {
      throw new AppError("UNAUTHORISED", "You cannot message this user.", 403);
    }

    // Find or create thread
    const [p1 = "", p2 = ""] = [userId, input.recipientId].sort();

    let thread = input.threadId
      ? await messageRepository.findThreadByIdFull(input.threadId)
      : await messageRepository.findThread(p1, p2, input.listingId ?? null);

    if (!thread) {
      thread = await messageRepository.createThread({
        participant1Id: p1,
        participant2Id: p2,
        listingId: input.listingId ?? null,
      });
    }

    // Content moderation
    const modResult = await moderateText(input.body, "message");
    if (!modResult.allowed) {
      throw new AppError(
        "MESSAGE_FLAGGED",
        modResult.reason ?? "Message contains prohibited content.",
        400,
      );
    }
    const flagged = modResult.flagged;
    const flagReason: string | null = modResult.flagReason ?? null;

    // Create message
    const message = await messageRepository.createMessage({
      threadId: thread.id,
      senderId: userId,
      body: input.body,
      flagged,
      flagReason,
    });

    // Update thread's lastMessageAt
    await messageRepository.touchThread(thread.id, new Date());

    // Emit Pusher event for real-time delivery
    try {
      const { getPusherServer } = await import("@/lib/pusher");
      const pusher = getPusherServer();
      await pusher.trigger(`private-user-${input.recipientId}`, "new-message", {
        threadId: thread.id,
        messageId: message.id,
        senderId: userId,
        senderName: userEmail.split("@")[0],
        preview: input.body.slice(0, 100),
        createdAt: message.createdAt.toISOString(),
      });
    } catch {
      logger.warn("message.pusher.failed", {
        threadId: thread.id,
        messageId: message.id,
      });
    }

    // Notify the recipient of new message (fire-and-forget, don't block send)
    const sender = await messageRepository.findUserDisplayName(userId);
    createNotification({
      userId: input.recipientId,
      type: "MESSAGE_RECEIVED",
      title: `New message from ${sender?.displayName ?? "Someone"}`,
      body: input.body.length > 80 ? `${input.body.slice(0, 77)}…` : input.body,
      listingId: input.listingId ?? undefined,
      link: "/dashboard/buyer?tab=messages",
    }).catch(() => {});

    // Send email notification to recipient (fire-and-forget)
    if (recipient.email) {
      sendNewMessageEmail({
        to: recipient.email,
        recipientName: recipient.displayName ?? "there",
        senderName: sender?.displayName ?? "Someone",
        messagePreview: input.body,
      }).catch(() => {});
    }

    return { messageId: message.id, threadId: thread.id };
  }

  async getMyThreads(
    userId: string,
    options?: { cursor?: string; limit?: number },
  ) {
    const limit = options?.limit ?? 20;
    const threads = await messageRepository.findThreadsByUser(
      userId,
      limit + 1,
      options?.cursor,
    );

    const hasMore = threads.length > limit;
    const page = hasMore ? threads.slice(0, limit) : threads;
    const nextCursor = hasMore ? (page.at(-1)?.id ?? null) : null;
    return { threads: page, nextCursor, hasMore };
  }

  async getThreadMessages(
    threadId: string,
    userId: string,
    options?: { take?: number; cursor?: string },
  ) {
    const thread = await messageRepository.findThreadById(threadId);

    if (!thread) return { messages: [], hasMore: false };
    if (thread.participant1Id !== userId && thread.participant2Id !== userId) {
      return { messages: [], hasMore: false };
    }

    // Mark messages as read
    await messageRepository.markThreadRead(threadId, userId);

    const take = options?.take ?? 50;

    const messages = await messageRepository.findMessagesByThread(
      threadId,
      take + 1, // fetch one extra to detect hasMore
      options?.cursor,
    );

    const hasMore = messages.length > take;
    if (hasMore) messages.pop(); // remove the extra

    return { messages, hasMore };
  }
}

export const messageService = new MessageService();
