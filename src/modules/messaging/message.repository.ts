import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Message repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/modules/messaging/message.service.ts
//   - src/server/actions/messages.ts
// ---------------------------------------------------------------------------

export type ThreadWithLastMessage = Prisma.MessageThreadGetPayload<{
  include: {
    participant1: {
      select: { id: true; displayName: true; username: true; avatarKey: true };
    };
    participant2: {
      select: { id: true; displayName: true; username: true; avatarKey: true };
    };
    listing: { select: { id: true; title: true; status: true } };
    messages: {
      take: 1;
      orderBy: { createdAt: "desc" };
      select: {
        id: true;
        body: true;
        senderId: true;
        createdAt: true;
        read: true;
      };
    };
  };
}>;

export type MessageRow = Prisma.MessageGetPayload<{
  select: {
    id: true;
    threadId: true;
    senderId: true;
    body: true;
    read: true;
    readAt: true;
    createdAt: true;
    flagged: true;
  };
}>;

export const messageRepository = {
  /** Find threads for a user (paginated, ordered by lastMessageAt desc).
   * @source src/modules/messaging/message.service.ts */
  async findThreadsByUser(
    userId: string,
    take: number,
    cursor?: string,
  ): Promise<ThreadWithLastMessage[]> {
    // TODO: move from src/modules/messaging/message.service.ts
    throw new Error("Not implemented");
  },

  /** Find an existing thread between two participants for a listing.
   * @source src/modules/messaging/message.service.ts */
  async findThread(
    participant1Id: string,
    participant2Id: string,
    listingId: string,
  ): Promise<Prisma.MessageThreadGetPayload<{ select: { id: true } }> | null> {
    // TODO: move from src/modules/messaging/message.service.ts
    throw new Error("Not implemented");
  },

  /** Find a thread by ID.
   * @source src/modules/messaging/message.service.ts */
  async findThreadById(id: string): Promise<Prisma.MessageThreadGetPayload<{
    select: {
      id: true;
      participant1Id: true;
      participant2Id: true;
      listingId: true;
    };
  }> | null> {
    // TODO: move from src/modules/messaging/message.service.ts
    throw new Error("Not implemented");
  },

  /** Create a new thread.
   * @source src/modules/messaging/message.service.ts */
  async createThread(
    data: Prisma.MessageThreadCreateInput,
  ): Promise<Prisma.MessageThreadGetPayload<{ select: { id: true } }>> {
    // TODO: move from src/modules/messaging/message.service.ts
    throw new Error("Not implemented");
  },

  /** Update thread lastMessageAt timestamp.
   * @source src/modules/messaging/message.service.ts */
  async touchThread(threadId: string, lastMessageAt: Date): Promise<void> {
    // TODO: move from src/modules/messaging/message.service.ts
    throw new Error("Not implemented");
  },

  /** Create a message in a thread.
   * @source src/modules/messaging/message.service.ts */
  async createMessage(data: Prisma.MessageCreateInput): Promise<MessageRow> {
    // TODO: move from src/modules/messaging/message.service.ts
    throw new Error("Not implemented");
  },

  /** Fetch paginated messages for a thread.
   * @source src/modules/messaging/message.service.ts */
  async findMessagesByThread(
    threadId: string,
    take: number,
    cursor?: string,
  ): Promise<MessageRow[]> {
    // TODO: move from src/modules/messaging/message.service.ts
    throw new Error("Not implemented");
  },

  /** Mark all unread messages in a thread as read (by the non-sender).
   * @source src/modules/messaging/message.service.ts */
  async markThreadRead(threadId: string, readerId: string): Promise<void> {
    // TODO: move from src/modules/messaging/message.service.ts
    throw new Error("Not implemented");
  },
};
