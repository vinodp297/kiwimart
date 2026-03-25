// src/test/message.service.test.ts
// ─── Tests for MessageService ───────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import './setup'
import { messageService } from '@/modules/messaging/message.service'
import { moderateText } from '@/server/lib/moderation'
import db from '@/lib/db'
import { AppError } from '@/shared/errors'

describe('MessageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── sendMessage ───────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    const validInput = {
      recipientId: 'recipient-1',
      body: 'Hello, is this item still available?',
      listingId: 'listing-1',
    }

    it('creates message in existing thread', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({ id: 'recipient-1' } as never)
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: 'thread-1',
        participant1Id: 'recipient-1',
        participant2Id: 'sender-1',
      } as never)
      vi.mocked(moderateText).mockResolvedValue({ allowed: true, flagged: false } as never)
      vi.mocked(db.message.create).mockResolvedValue({
        id: 'msg-1',
        createdAt: new Date(),
      } as never)
      vi.mocked(db.messageThread.update).mockResolvedValue({} as never)

      const result = await messageService.sendMessage(validInput, 'sender-1', 'sender@test.com')

      expect(result.messageId).toBe('msg-1')
      expect(result.threadId).toBe('thread-1')
      expect(db.message.create).toHaveBeenCalled()
    })

    it('creates new thread when none exists', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({ id: 'recipient-1' } as never)
      vi.mocked(db.messageThread.findFirst).mockResolvedValue(null)
      vi.mocked(db.messageThread.create).mockResolvedValue({
        id: 'thread-new',
        participant1Id: 'recipient-1',
        participant2Id: 'sender-1',
      } as never)
      vi.mocked(moderateText).mockResolvedValue({ allowed: true, flagged: false } as never)
      vi.mocked(db.message.create).mockResolvedValue({
        id: 'msg-new',
        createdAt: new Date(),
      } as never)
      vi.mocked(db.messageThread.update).mockResolvedValue({} as never)

      const result = await messageService.sendMessage(validInput, 'sender-1', 'sender@test.com')

      expect(db.messageThread.create).toHaveBeenCalled()
      expect(result.threadId).toBe('thread-new')
    })

    it('rejects self-messaging', async () => {
      await expect(
        messageService.sendMessage(
          { ...validInput, recipientId: 'sender-1' },
          'sender-1',
          'sender@test.com'
        )
      ).rejects.toThrow('Cannot send a message to yourself')
    })

    it('rejects message when recipient not found', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue(null)

      await expect(
        messageService.sendMessage(validInput, 'sender-1', 'sender@test.com')
      ).rejects.toThrow(AppError)
    })

    it('rejects flagged message content', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({ id: 'recipient-1' } as never)
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: 'thread-1',
        participant1Id: 'recipient-1',
        participant2Id: 'sender-1',
      } as never)
      vi.mocked(moderateText).mockResolvedValue({
        allowed: false,
        flagged: true,
        reason: 'Contains phone number',
      } as never)

      await expect(
        messageService.sendMessage(
          { ...validInput, body: 'Call me on 021 123 4567' },
          'sender-1',
          'sender@test.com'
        )
      ).rejects.toThrow('Contains phone number')

      expect(db.message.create).not.toHaveBeenCalled()
    })
  })

  // ── getMyThreads ──────────────────────────────────────────────────────────

  describe('getMyThreads', () => {
    it('returns threads for user', async () => {
      const mockThreads = [
        { id: 'thread-1', messages: [{ id: 'msg-1', body: 'Hi', senderId: 'u-1' }] },
        { id: 'thread-2', messages: [{ id: 'msg-2', body: 'Hey', senderId: 'u-2' }] },
      ]
      vi.mocked(db.messageThread.findMany).mockResolvedValue(mockThreads as never)

      const result = await messageService.getMyThreads('user-1')

      expect(result).toHaveLength(2)
      expect(db.messageThread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { participant1Id: 'user-1' },
              { participant2Id: 'user-1' },
            ],
          },
        })
      )
    })

    it('returns empty array when no threads', async () => {
      vi.mocked(db.messageThread.findMany).mockResolvedValue([])

      const result = await messageService.getMyThreads('user-1')

      expect(result).toEqual([])
    })
  })

  // ── getThreadMessages ─────────────────────────────────────────────────────

  describe('getThreadMessages', () => {
    it('returns messages and marks as read', async () => {
      vi.mocked(db.messageThread.findUnique).mockResolvedValue({
        participant1Id: 'user-1',
        participant2Id: 'user-2',
      } as never)
      vi.mocked(db.message.updateMany).mockResolvedValue({ count: 2 } as never)
      vi.mocked(db.message.findMany).mockResolvedValue([
        { id: 'msg-1', body: 'Hello', senderId: 'user-2' },
      ] as never)

      const result = await messageService.getThreadMessages('thread-1', 'user-1')

      expect(result).toHaveLength(1)
      expect(db.message.updateMany).toHaveBeenCalled()
    })

    it('returns empty array for non-existent thread', async () => {
      vi.mocked(db.messageThread.findUnique).mockResolvedValue(null)

      const result = await messageService.getThreadMessages('nope', 'user-1')

      expect(result).toEqual([])
    })

    it('returns empty array when user is not participant', async () => {
      vi.mocked(db.messageThread.findUnique).mockResolvedValue({
        participant1Id: 'user-2',
        participant2Id: 'user-3',
      } as never)

      const result = await messageService.getThreadMessages('thread-1', 'user-1')

      expect(result).toEqual([])
    })
  })
})
