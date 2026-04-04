import db from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Message repository — data access only, no business logic.
// Phase 2A: methods used by message.service.ts (implemented below).
// Phase 2B stubs: reserved for src/server/actions/messages.ts migration.
// ---------------------------------------------------------------------------

type DbClient = Prisma.TransactionClient | typeof db;

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
  // ─── Phase 2A: User lookups (used by sendMessage) ──────────────────────────

  /** Find a non-banned, non-deleted user by ID (recipient check). */
  async findActiveUserById(userId: string, client: DbClient = db) {
    return client.user.findUnique({
      where: { id: userId, isBanned: false, deletedAt: null },
      select: { id: true, email: true, displayName: true },
    });
  },

  /** Find a user by ID (sender display name lookup). */
  async findUserDisplayName(userId: string, client: DbClient = db) {
    return client.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
  },

  // ─── Phase 2A: Block check ─────────────────────────────────────────────────

  /** Check if a block exists between two users (in either direction). */
  async findBlock(userA: string, userB: string, client: DbClient = db) {
    return client.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: userA, blockedId: userB },
          { blockerId: userB, blockedId: userA },
        ],
      },
      select: { id: true },
    });
  },

  // ─── Phase 2A: Thread operations ───────────────────────────────────────────

  /** Find a thread by ID (participant-only select for access check). */
  async findThreadById(id: string, client: DbClient = db) {
    return client.messageThread.findUnique({
      where: { id },
      select: {
        id: true,
        participant1Id: true,
        participant2Id: true,
        listingId: true,
      },
    });
  },

  /** Find a thread by its unique ID (full row, used by sendMessage thread lookup). */
  async findThreadByIdFull(id: string, client: DbClient = db) {
    return client.messageThread.findUnique({ where: { id } });
  },

  /** Find an existing thread between two sorted participants for a listing. */
  async findThread(
    participant1Id: string,
    participant2Id: string,
    listingId: string | null,
    client: DbClient = db,
  ) {
    return client.messageThread.findFirst({
      where: {
        participant1Id,
        participant2Id,
        listingId,
      },
    });
  },

  /** Create a new thread. */
  async createThread(
    data: {
      participant1Id: string;
      participant2Id: string;
      listingId: string | null;
    },
    client: DbClient = db,
  ) {
    return client.messageThread.create({ data });
  },

  /** Update thread lastMessageAt timestamp. */
  async touchThread(
    threadId: string,
    lastMessageAt: Date,
    client: DbClient = db,
  ): Promise<void> {
    await client.messageThread.update({
      where: { id: threadId },
      data: { lastMessageAt },
    });
  },

  /** Find threads for a user (paginated, ordered by lastMessageAt desc). */
  async findThreadsByUser(
    userId: string,
    take: number,
    cursor?: string,
    client: DbClient = db,
  ) {
    return client.messageThread.findMany({
      where: {
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      include: {
        messages: {
          orderBy: { createdAt: "desc" as const },
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
      orderBy: { lastMessageAt: "desc" as const },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  },

  // ─── Phase 2A: Message operations ──────────────────────────────────────────

  /** Create a message in a thread. */
  async createMessage(
    data: {
      threadId: string;
      senderId: string;
      body: string;
      flagged: boolean;
      flagReason: string | null;
    },
    client: DbClient = db,
  ) {
    return client.message.create({
      data,
      select: { id: true, createdAt: true },
    });
  },

  /** Mark all unread messages in a thread as read (by the non-sender). */
  async markThreadRead(
    threadId: string,
    readerId: string,
    client: DbClient = db,
  ): Promise<void> {
    await client.message.updateMany({
      where: {
        threadId,
        senderId: { not: readerId },
        read: false,
      },
      data: { read: true, readAt: new Date() },
    });
  },

  /** Fetch paginated messages for a thread. */
  async findMessagesByThread(
    threadId: string,
    take: number,
    cursor?: string,
    client: DbClient = db,
  ) {
    return client.message.findMany({
      where: { threadId },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "asc" as const },
      select: {
        id: true,
        body: true,
        senderId: true,
        createdAt: true,
        read: true,
        sender: { select: { displayName: true } },
      },
    });
  },
};
