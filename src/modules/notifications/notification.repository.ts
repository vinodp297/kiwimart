import db from "@/lib/db";
import { Prisma } from "@prisma/client";
import { userRepository } from "@/modules/users/user.repository";

// ---------------------------------------------------------------------------
// Notification repository — data access only, no business logic.
// ---------------------------------------------------------------------------

type DbClient = Prisma.TransactionClient | typeof db;

// ── Select shape ────────────────────────────────────────────────────────────

const notificationSelect = {
  id: true,
  userId: true,
  type: true,
  title: true,
  body: true,
  link: true,
  read: true,
  createdAt: true,
  listingId: true,
  orderId: true,
} as const;

export type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

export interface NotifyAdminsPayload {
  /** Notification type string (e.g. "SYSTEM"). */
  type: string;
  title: string;
  body: string;
  link?: string;
}

// ── Repository ──────────────────────────────────────────────────────────────

export const notificationRepository = {
  /** Create a single notification.
   * @source src/modules/notifications/notification.service.ts */
  async create(
    data: Prisma.NotificationUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<NotificationRow> {
    const client = tx ?? db;
    return client.notification.create({ data, select: notificationSelect });
  },

  /** Fetch notifications for a user (newest-first, cursor-paginated).
   * @source src/app/api/notifications/route.ts */
  async findByUser(
    userId: string,
    take: number,
    cursor?: string,
    tx?: DbClient,
  ): Promise<NotificationRow[]> {
    const client = tx ?? db;
    return client.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: notificationSelect,
    });
  },

  /** Mark specific notifications as read (scoped to userId for safety).
   * @source src/app/api/notifications/route.ts */
  async markRead(
    notificationIds: string[],
    userId: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = tx ?? db;
    await client.notification.updateMany({
      where: { id: { in: notificationIds }, userId },
      data: { read: true },
    });
  },

  /** Mark all unread notifications as read for a user.
   * @source src/app/(protected)/notifications/page.tsx, src/app/api/notifications/route.ts */
  async markAllRead(userId: string, tx?: DbClient): Promise<void> {
    const client = tx ?? db;
    await client.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  },

  /** Count unread notifications for a user.
   * @source src/components/NavBar.tsx */
  async countUnread(userId: string, tx?: DbClient): Promise<number> {
    const client = tx ?? db;
    return client.notification.count({
      where: { userId, read: false },
    });
  },

  /** Check whether a reminder notification was already sent for an order
   * within a time window (deduplication).
   * @source src/server/jobs/dispatchReminders.ts */
  async findRecentReminder(
    userId: string,
    orderId: string,
    type: string,
    since: Date,
    tx?: DbClient,
  ): Promise<Prisma.NotificationGetPayload<{ select: { id: true } }> | null> {
    const client = tx ?? db;
    return client.notification.findFirst({
      where: { userId, orderId, type, createdAt: { gte: since } },
      select: { id: true },
    });
  },

  /** Notify all admins with a notification, in parallel inside a transaction.
   *
   * Fetches admin IDs via `userRepository.findAdmins(roles?)`, then inserts
   * one notification per admin in a single `db.$transaction` using
   * `Promise.all` — not sequential.
   *
   * Callers must fire-and-forget: `notifyAdmins(...).catch(() => {})`
   *
   * @param payload - notification content
   * @param roles   - optional role filter passed to findAdmins() */
  async notifyAdmins(
    payload: NotifyAdminsPayload,
    roles?: string[],
  ): Promise<void> {
    const admins = await userRepository.findAdmins(roles);
    if (admins.length === 0) return;

    await db.$transaction(
      admins.map((admin) =>
        db.notification.create({
          data: {
            userId: admin.id,
            type: payload.type,
            title: payload.title,
            body: payload.body,
            link: payload.link ?? null,
            read: false,
          },
        }),
      ),
    );
  },
};
