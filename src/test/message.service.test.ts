// src/test/message.service.test.ts
// ─── Tests for MessageService ───────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { messageService } from "@/modules/messaging/message.service";
import { moderateText } from "@/server/lib/moderation";
import db from "@/lib/db";
import { AppError } from "@/shared/errors";

// ── Additional mocks for notification / email tests ────────────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/email", () => ({
  sendNewMessageEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}));

import { createNotification } from "@/modules/notifications/notification.service";
import { sendNewMessageEmail } from "@/server/email";

describe("MessageService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── sendMessage ───────────────────────────────────────────────────────────

  describe("sendMessage", () => {
    const validInput = {
      recipientId: "recipient-1",
      body: "Hello, is this item still available?",
      listingId: "listing-1",
    };

    it("creates message in existing thread", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "recipient-1",
      } as never);
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
        participant1Id: "recipient-1",
        participant2Id: "sender-1",
      } as never);
      vi.mocked(moderateText).mockResolvedValue({
        allowed: true,
        flagged: false,
      } as never);
      vi.mocked(db.message.create).mockResolvedValue({
        id: "msg-1",
        createdAt: new Date(),
      } as never);
      vi.mocked(db.messageThread.update).mockResolvedValue({} as never);

      const result = await messageService.sendMessage(
        validInput,
        "sender-1",
        "sender@test.com",
      );

      expect(result.messageId).toBe("msg-1");
      expect(result.threadId).toBe("thread-1");
      expect(db.message.create).toHaveBeenCalled();
    });

    it("creates new thread when none exists", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "recipient-1",
      } as never);
      vi.mocked(db.messageThread.findFirst).mockResolvedValue(null);
      vi.mocked(db.messageThread.create).mockResolvedValue({
        id: "thread-new",
        participant1Id: "recipient-1",
        participant2Id: "sender-1",
      } as never);
      vi.mocked(moderateText).mockResolvedValue({
        allowed: true,
        flagged: false,
      } as never);
      vi.mocked(db.message.create).mockResolvedValue({
        id: "msg-new",
        createdAt: new Date(),
      } as never);
      vi.mocked(db.messageThread.update).mockResolvedValue({} as never);

      const result = await messageService.sendMessage(
        validInput,
        "sender-1",
        "sender@test.com",
      );

      expect(db.messageThread.create).toHaveBeenCalled();
      expect(result.threadId).toBe("thread-new");
    });

    it("rejects self-messaging", async () => {
      await expect(
        messageService.sendMessage(
          { ...validInput, recipientId: "sender-1" },
          "sender-1",
          "sender@test.com",
        ),
      ).rejects.toThrow("Cannot send a message to yourself");
    });

    it("rejects message when recipient not found", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue(null);

      await expect(
        messageService.sendMessage(validInput, "sender-1", "sender@test.com"),
      ).rejects.toThrow(AppError);
    });

    it("rejects flagged message content", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "recipient-1",
      } as never);
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
        participant1Id: "recipient-1",
        participant2Id: "sender-1",
      } as never);
      vi.mocked(moderateText).mockResolvedValue({
        allowed: false,
        flagged: true,
        reason: "Contains phone number",
      } as never);

      await expect(
        messageService.sendMessage(
          { ...validInput, body: "Call me on 021 123 4567" },
          "sender-1",
          "sender@test.com",
        ),
      ).rejects.toThrow("Contains phone number");

      expect(db.message.create).not.toHaveBeenCalled();
    });

    it("rejects message from blocked user", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "recipient-1",
        email: "recipient@test.com",
        displayName: "Recipient",
      } as never);
      vi.mocked(db.blockedUser.findFirst).mockResolvedValue({
        id: "block-1",
      } as never);

      await expect(
        messageService.sendMessage(validInput, "sender-1", "sender@test.com"),
      ).rejects.toThrow("cannot message this user");

      expect(db.message.create).not.toHaveBeenCalled();
    });

    it("updates thread lastMessageAt on send", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "recipient-1",
        email: "recipient@test.com",
        displayName: "Recipient",
      } as never);
      vi.mocked(db.blockedUser.findFirst).mockResolvedValue(null);
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
        participant1Id: "recipient-1",
        participant2Id: "sender-1",
      } as never);
      vi.mocked(moderateText).mockResolvedValue({
        allowed: true,
        flagged: false,
      } as never);
      vi.mocked(db.message.create).mockResolvedValue({
        id: "msg-1",
        createdAt: new Date(),
      } as never);
      vi.mocked(db.messageThread.update).mockResolvedValue({} as never);

      await messageService.sendMessage(
        validInput,
        "sender-1",
        "sender@test.com",
      );

      expect(db.messageThread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "thread-1" },
          data: { lastMessageAt: expect.any(Date) },
        }),
      );
    });

    it("sends notification to recipient", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "recipient-1",
        email: "recipient@test.com",
        displayName: "Recipient",
      } as never);
      vi.mocked(db.blockedUser.findFirst).mockResolvedValue(null);
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
        participant1Id: "recipient-1",
        participant2Id: "sender-1",
      } as never);
      vi.mocked(moderateText).mockResolvedValue({
        allowed: true,
        flagged: false,
      } as never);
      vi.mocked(db.message.create).mockResolvedValue({
        id: "msg-1",
        createdAt: new Date(),
      } as never);
      vi.mocked(db.messageThread.update).mockResolvedValue({} as never);

      await messageService.sendMessage(
        validInput,
        "sender-1",
        "sender@test.com",
      );

      // Wait for fire-and-forget promises to settle
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "recipient-1",
          type: "MESSAGE_RECEIVED",
        }),
      );
    });

    it("sends email notification to recipient", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "recipient-1",
        email: "recipient@test.com",
        displayName: "Recipient",
      } as never);
      vi.mocked(db.blockedUser.findFirst).mockResolvedValue(null);
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
        participant1Id: "recipient-1",
        participant2Id: "sender-1",
      } as never);
      vi.mocked(moderateText).mockResolvedValue({
        allowed: true,
        flagged: false,
      } as never);
      vi.mocked(db.message.create).mockResolvedValue({
        id: "msg-1",
        createdAt: new Date(),
      } as never);
      vi.mocked(db.messageThread.update).mockResolvedValue({} as never);

      await messageService.sendMessage(
        validInput,
        "sender-1",
        "sender@test.com",
      );

      // Wait for fire-and-forget promises to settle
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(sendNewMessageEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "recipient@test.com",
          recipientName: "Recipient",
        }),
      );
    });
  });

  // ── getMyThreads ──────────────────────────────────────────────────────────

  describe("getMyThreads", () => {
    it("returns threads for user", async () => {
      const mockThreads = [
        {
          id: "thread-1",
          messages: [{ id: "msg-1", body: "Hi", senderId: "u-1" }],
        },
        {
          id: "thread-2",
          messages: [{ id: "msg-2", body: "Hey", senderId: "u-2" }],
        },
      ];
      vi.mocked(db.messageThread.findMany).mockResolvedValue(
        mockThreads as never,
      );

      const result = await messageService.getMyThreads("user-1");

      expect(result).toHaveLength(2);
      expect(db.messageThread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ participant1Id: "user-1" }, { participant2Id: "user-1" }],
          },
        }),
      );
    });

    it("returns empty array when no threads", async () => {
      vi.mocked(db.messageThread.findMany).mockResolvedValue([]);

      const result = await messageService.getMyThreads("user-1");

      expect(result).toEqual([]);
    });
  });

  // ── getThreadMessages ─────────────────────────────────────────────────────

  describe("getThreadMessages", () => {
    it("returns messages and marks as read", async () => {
      vi.mocked(db.messageThread.findUnique).mockResolvedValue({
        participant1Id: "user-1",
        participant2Id: "user-2",
      } as never);
      vi.mocked(db.message.updateMany).mockResolvedValue({ count: 2 } as never);
      vi.mocked(db.message.findMany).mockResolvedValue([
        { id: "msg-1", body: "Hello", senderId: "user-2" },
      ] as never);

      const result = await messageService.getThreadMessages(
        "thread-1",
        "user-1",
      );

      expect(result.messages).toHaveLength(1);
      expect(result.hasMore).toBe(false);
      expect(db.message.updateMany).toHaveBeenCalled();
    });

    it("returns empty for non-existent thread", async () => {
      vi.mocked(db.messageThread.findUnique).mockResolvedValue(null);

      const result = await messageService.getThreadMessages("nope", "user-1");

      expect(result).toEqual({ messages: [], hasMore: false });
    });

    it("returns empty when user is not participant", async () => {
      vi.mocked(db.messageThread.findUnique).mockResolvedValue({
        participant1Id: "user-2",
        participant2Id: "user-3",
      } as never);

      const result = await messageService.getThreadMessages(
        "thread-1",
        "user-1",
      );

      expect(result).toEqual({ messages: [], hasMore: false });
    });
  });
});
