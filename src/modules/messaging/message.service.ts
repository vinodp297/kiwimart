// src/modules/messaging/message.service.ts
// ─── Message Service ─────────────────────────────────────────────────────────
// Thread and message operations. Framework-free.

import db from '@/lib/db'
import { moderateText } from '@/server/lib/moderation'
import { logger } from '@/shared/logger'
import { AppError } from '@/shared/errors'
import { createNotification } from '@/modules/notifications/notification.service'
import { sendNewMessageEmail } from '@/server/email'
import type { SendMessageInput, SendMessageResult } from './message.types'

export class MessageService {
  async sendMessage(input: SendMessageInput, userId: string, userEmail: string): Promise<SendMessageResult> {
    if (input.recipientId === userId) {
      throw AppError.validation('Cannot send a message to yourself.')
    }

    // Verify recipient exists and is not banned
    const recipient = await db.user.findUnique({
      where: { id: input.recipientId, isBanned: false, deletedAt: null },
      select: { id: true, email: true, displayName: true },
    })
    if (!recipient) throw AppError.notFound('Recipient')

    // Check if either party has blocked the other
    const block = await db.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: userId,           blockedId: input.recipientId },
          { blockerId: input.recipientId, blockedId: userId },
        ],
      },
      select: { id: true },
    })
    if (block) {
      throw new AppError('UNAUTHORISED', 'You cannot message this user.', 403)
    }

    // Find or create thread
    const [p1, p2] = [userId, input.recipientId].sort()

    let thread = input.threadId
      ? await db.messageThread.findUnique({ where: { id: input.threadId } })
      : await db.messageThread.findFirst({
          where: {
            participant1Id: p1,
            participant2Id: p2,
            listingId: input.listingId ?? null,
          },
        })

    if (!thread) {
      thread = await db.messageThread.create({
        data: {
          participant1Id: p1,
          participant2Id: p2,
          listingId: input.listingId ?? null,
        },
      })
    }

    // Content moderation
    const modResult = await moderateText(input.body, 'message')
    if (!modResult.allowed) {
      throw new AppError('MESSAGE_FLAGGED', modResult.reason ?? 'Message contains prohibited content.', 400)
    }
    const flagged = modResult.flagged
    const flagReason: string | null = modResult.flagReason ?? null

    // Create message
    const message = await db.message.create({
      data: {
        threadId: thread.id,
        senderId: userId,
        body: input.body,
        flagged,
        flagReason,
      },
      select: { id: true, createdAt: true },
    })

    // Update thread's lastMessageAt
    await db.messageThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date() },
    })

    // Emit Pusher event for real-time delivery
    try {
      const { getPusherServer } = await import('@/lib/pusher')
      const pusher = getPusherServer()
      await pusher.trigger(
        `private-user-${input.recipientId}`,
        'new-message',
        {
          threadId: thread.id,
          messageId: message.id,
          senderId: userId,
          senderName: userEmail.split('@')[0],
          preview: input.body.slice(0, 100),
          createdAt: message.createdAt.toISOString(),
        }
      )
    } catch {
      logger.warn('message.pusher.failed', { threadId: thread.id, messageId: message.id })
    }

    // Notify the recipient of new message (fire-and-forget, don't block send)
    const sender = await db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    })
    createNotification({
      userId:    input.recipientId,
      type:      'MESSAGE_RECEIVED',
      title:     `New message from ${sender?.displayName ?? 'Someone'}`,
      body:      input.body.length > 80 ? `${input.body.slice(0, 77)}…` : input.body,
      listingId: input.listingId ?? undefined,
      link:      '/dashboard/buyer?tab=messages',
    }).catch(() => {})

    // Send email notification to recipient (fire-and-forget)
    if (recipient.email) {
      sendNewMessageEmail({
        to:             recipient.email,
        recipientName:  recipient.displayName ?? 'there',
        senderName:     sender?.displayName ?? 'Someone',
        messagePreview: input.body,
      }).catch(() => {})
    }

    return { messageId: message.id, threadId: thread.id }
  }

  async getMyThreads(userId: string) {
    return db.messageThread.findMany({
      where: {
        OR: [
          { participant1Id: userId },
          { participant2Id: userId },
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
    })
  }

  async getThreadMessages(threadId: string, userId: string) {
    const thread = await db.messageThread.findUnique({
      where: { id: threadId },
      select: { participant1Id: true, participant2Id: true },
    })

    if (!thread) return []
    if (thread.participant1Id !== userId && thread.participant2Id !== userId) {
      return []
    }

    // Mark messages as read
    await db.message.updateMany({
      where: {
        threadId,
        senderId: { not: userId },
        read: false,
      },
      data: { read: true, readAt: new Date() },
    })

    return db.message.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        body: true,
        senderId: true,
        createdAt: true,
        read: true,
        sender: { select: { displayName: true } },
      },
    })
  }
}

export const messageService = new MessageService()
