import db, { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { userRepository } from "@/modules/users/user.repository";
import { hashPushToken } from "@/lib/push-token-hash";

// ── Push token types ────────────────────────────────────────────────────────

export type PushPlatform = "ios" | "android" | "web";

export interface PushTokenRow {
  id: string;
  userId: string;
  token: string;
  platform: string;
  deviceId: string | null;
  isActive: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Notification repository — data access only, no business logic.
// ---------------------------------------------------------------------------

// ── Select shape ────────────────────────────────────────────────────────────

const notificationSelect = {
  id: true,
  userId: true,
  type: true,
  title: true,
  body: true,
  link: true,
  isRead: true,
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
  /** Create a single notification. */
  async create(
    data: Prisma.NotificationUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<NotificationRow> {
    const client = getClient(tx);
    return client.notification.create({ data, select: notificationSelect });
  },

  /** Fetch notifications for a user (newest-first, cursor-paginated). */
  async findByUser(
    userId: string,
    take: number,
    cursor?: string,
    tx?: DbClient,
  ): Promise<NotificationRow[]> {
    const client = getClient(tx);
    return client.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: notificationSelect,
    });
  },

  /** Mark specific notifications as read (scoped to userId for safety). */
  async markRead(
    notificationIds: string[],
    userId: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.notification.updateMany({
      where: { id: { in: notificationIds }, userId },
      data: { isRead: true },
    });
  },

  /** Mark all unread notifications as read for a user. */
  async markAllRead(userId: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  },

  /** Count unread notifications for a user. */
  async countUnread(userId: string, tx?: DbClient): Promise<number> {
    const client = getClient(tx);
    return client.notification.count({
      where: { userId, isRead: false },
    });
  },

  /** Check whether a reminder notification was already sent for an order
   * within a time window (deduplication). */
  async findRecentReminder(
    userId: string,
    orderId: string,
    type: string,
    since: Date,
    tx?: DbClient,
  ): Promise<Prisma.NotificationGetPayload<{ select: { id: true } }> | null> {
    const client = getClient(tx);
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
   * Callers must fire-and-forget: `fireAndForget(notifyAdmins(...), 'context')`
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
            isRead: false,
          },
        }),
      ),
    );
  },

  // ── Push token methods ────────────────────────────────────────────────────

  /**
   * Upsert a push token for a user.
   * If the token already exists (e.g. after app reinstall with the same token),
   * update lastUsedAt and re-activate it. If new, create it.
   *
   * The SHA-256 hash of the token is used as the DB unique key (tokenHash).
   * The raw token is also stored so the push-service caller can read it back.
   * Token is never logged — only the first 8 characters for diagnostics.
   */
  async upsertPushToken(
    userId: string,
    token: string,
    platform: PushPlatform,
    deviceId?: string,
  ): Promise<PushTokenRow> {
    const tokenHash = hashPushToken(token);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (db.pushToken as any).upsert({
      where: { tokenHash },
      update: {
        userId,
        platform,
        deviceId: deviceId ?? null,
        isActive: true,
        lastUsedAt: new Date(),
      },
      create: {
        userId,
        token,
        tokenHash,
        platform,
        deviceId: deviceId ?? null,
        isActive: true,
        lastUsedAt: new Date(),
      },
    });
  },

  /**
   * Soft-delete a push token by marking it inactive.
   * Called on sign-out or when the device explicitly unregisters.
   * Preserves the row for audit purposes — the weekly cleanup job
   * hard-deletes tokens that have been inactive for 90+ days.
   */
  async deactivatePushToken(token: string): Promise<void> {
    const tokenHash = hashPushToken(token);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.pushToken as any).updateMany({
      where: { tokenHash },
      data: { isActive: false },
    });
  },

  /**
   * Return all active push tokens for a user.
   * Used by the notification sender to fan out to all devices.
   */
  async getActivePushTokensByUserId(userId: string): Promise<PushTokenRow[]> {
    return db.pushToken.findMany({
      where: { userId, isActive: true },
      orderBy: { lastUsedAt: "desc" },
    });
  },

  /**
   * Hard-delete push tokens that have been inactive for 90+ days.
   * Intended to be called by the weekly cleanup cron job.
   * Returns the count of deleted rows for logging.
   */
  async deleteInactivePushTokens(): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const result = await db.pushToken.deleteMany({
      where: {
        isActive: false,
        updatedAt: { lt: cutoff },
      },
    });
    return result.count;
  },

  /**
   * Bulk-find recent SYSTEM notifications attached to the given orders —
   * used by the dispatch-reminder cron to dedupe reminders within a 12-hour
   * cooldown without issuing N findFirst calls.
   */
  async findRecentSystemForOrders(
    orderIds: string[],
    since: Date,
  ): Promise<Array<{ orderId: string | null }>> {
    return db.notification.findMany({
      where: {
        orderId: { in: orderIds },
        type: "SYSTEM",
        createdAt: { gte: since },
      },
      select: { orderId: true },
    });
  },
};
