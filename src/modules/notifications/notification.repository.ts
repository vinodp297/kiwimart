import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Notification repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/modules/notifications/notification.service.ts
//   - src/app/api/notifications/route.ts
//   - src/server/jobs/dispatchReminders.ts
// ---------------------------------------------------------------------------

export type NotificationRow = Prisma.NotificationGetPayload<{
  select: {
    id: true;
    userId: true;
    type: true;
    title: true;
    body: true;
    link: true;
    read: true;
    createdAt: true;
    listingId: true;
    orderId: true;
  };
}>;

export const notificationRepository = {
  /** Create a notification.
   * @source src/modules/notifications/notification.service.ts */
  async create(data: Prisma.NotificationCreateInput): Promise<NotificationRow> {
    // TODO: move from src/modules/notifications/notification.service.ts
    throw new Error("Not implemented");
  },

  /** Fetch notifications for a user (paginated, ordered by createdAt desc).
   * @source src/app/api/notifications/route.ts */
  async findByUser(
    userId: string,
    take: number,
    cursor?: string,
  ): Promise<NotificationRow[]> {
    // TODO: move from src/app/api/notifications/route.ts
    throw new Error("Not implemented");
  },

  /** Mark specific notifications as read.
   * @source src/app/api/notifications/route.ts */
  async markRead(notificationIds: string[], userId: string): Promise<void> {
    // TODO: move from src/app/api/notifications/route.ts
    throw new Error("Not implemented");
  },

  /** Mark all notifications as read for a user.
   * @source src/app/(protected)/notifications/page.tsx */
  async markAllRead(userId: string): Promise<void> {
    // TODO: move from src/app/(protected)/notifications/page.tsx
    throw new Error("Not implemented");
  },

  /** Count unread notifications for a user.
   * @source src/components/NavBar.tsx */
  async countUnread(userId: string): Promise<number> {
    // TODO: move from src/components/NavBar.tsx
    throw new Error("Not implemented");
  },

  /** Check whether a reminder notification was already sent for an order
   * within a time window (deduplication).
   * @source src/server/jobs/dispatchReminders.ts */
  async findRecentReminder(
    userId: string,
    orderId: string,
    type: string,
    since: Date,
  ): Promise<Prisma.NotificationGetPayload<{ select: { id: true } }> | null> {
    // TODO: move from src/server/jobs/dispatchReminders.ts
    throw new Error("Not implemented");
  },
};
