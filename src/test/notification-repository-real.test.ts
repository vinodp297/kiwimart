// src/test/notification-repository-real.test.ts
// ─── Coverage tests: notificationRepository actual implementation ─────────────
// The notification.service.test.ts mocks the entire repository, so none of the
// actual Prisma calls run there. These tests exercise the real implementation
// (with the db mock from setup.ts) to cover the remaining uncovered statements.

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import "./setup";
import db from "@/lib/db";
import { notificationRepository } from "@/modules/notifications/notification.repository";

vi.mock("server-only", () => ({}));

// ── Extend the global db.notification mock with methods missing from fixtures ─
// The createMockDb() fixture only defines findMany + create on notification.
// The repository also uses count, findFirst, and updateMany — add them once
// so all tests in this file can use them without TS errors.

beforeAll(() => {
  const n = db.notification as unknown as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  if (!n.count) n.count = vi.fn();
  if (!n.findFirst) n.findFirst = vi.fn();
  if (!n.updateMany) n.updateMany = vi.fn();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("notificationRepository — actual implementation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply defaults after clearAllMocks wipes the implementations
    const n = db.notification as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    n.count!.mockResolvedValue(0);
    n.findFirst!.mockResolvedValue(null);
    n.updateMany!.mockResolvedValue({ count: 0 });
    vi.mocked(db.notification.findMany).mockResolvedValue([]);
    vi.mocked(db.notification.create).mockResolvedValue({
      id: "notif-1",
    } as never);
    vi.mocked(db.user.findMany).mockResolvedValue([]);
  });

  // ── countUnread ─────────────────────────────────────────────────────────────

  describe("countUnread", () => {
    it("queries notification count filtered by userId and isRead: false", async () => {
      const n = db.notification as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      n.count!.mockResolvedValue(5);

      const result = await notificationRepository.countUnread("user-1");

      expect(result).toBe(5);
      expect(n.count).toHaveBeenCalledWith({
        where: { userId: "user-1", isRead: false },
      });
    });

    it("returns 0 when user has no unread notifications", async () => {
      const result = await notificationRepository.countUnread("user-empty");
      expect(result).toBe(0);
    });
  });

  // ── findRecentReminder ──────────────────────────────────────────────────────

  describe("findRecentReminder", () => {
    it("finds reminder notification for the given order, type, and time window", async () => {
      const since = new Date("2026-01-01");
      const mockNotif = { id: "notif-1" };
      const n = db.notification as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      n.findFirst!.mockResolvedValue(mockNotif);

      const result = await notificationRepository.findRecentReminder(
        "user-1",
        "order-1",
        "DISPATCH_REMINDER",
        since,
      );

      expect(result).toEqual(mockNotif);
      expect(n.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          orderId: "order-1",
          type: "DISPATCH_REMINDER",
          createdAt: { gte: since },
        },
        select: { id: true },
      });
    });

    it("returns null when no reminder exists within the time window", async () => {
      const result = await notificationRepository.findRecentReminder(
        "user-1",
        "order-99",
        "DISPATCH_REMINDER",
        new Date(),
      );

      expect(result).toBeNull();
    });
  });

  // ── markAllRead ─────────────────────────────────────────────────────────────

  describe("markAllRead", () => {
    it("marks all unread notifications as read for a user", async () => {
      const n = db.notification as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      n.updateMany!.mockResolvedValue({ count: 4 });

      await notificationRepository.markAllRead("user-1");

      expect(n.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", isRead: false },
        data: { isRead: true },
      });
    });
  });

  // ── markRead ────────────────────────────────────────────────────────────────

  describe("markRead", () => {
    it("marks specific notifications as read scoped to userId", async () => {
      const n = db.notification as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      n.updateMany!.mockResolvedValue({ count: 2 });

      await notificationRepository.markRead(["notif-1", "notif-2"], "user-1");

      expect(n.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["notif-1", "notif-2"] }, userId: "user-1" },
        data: { isRead: true },
      });
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("persists a notification and returns the created row", async () => {
      const mockRow = {
        id: "notif-new",
        userId: "user-1",
        type: "SYSTEM",
        title: "Hello",
        body: "World",
        link: null,
        isRead: false,
        createdAt: new Date(),
        listingId: null,
        orderId: null,
      };
      vi.mocked(db.notification.create).mockResolvedValue(mockRow as never);

      const result = await notificationRepository.create({
        userId: "user-1",
        type: "SYSTEM",
        title: "Hello",
        body: "World",
        isRead: false,
      });

      expect(result).toEqual(mockRow);
      expect(db.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: "user-1", type: "SYSTEM" }),
        }),
      );
    });
  });

  // ── findByUser ──────────────────────────────────────────────────────────────

  describe("findByUser", () => {
    it("queries notifications newest-first with take limit", async () => {
      const mockRows = [{ id: "notif-1" }, { id: "notif-2" }];
      vi.mocked(db.notification.findMany).mockResolvedValue(mockRows as never);

      const result = await notificationRepository.findByUser("user-1", 20);

      expect(result).toEqual(mockRows);
      expect(db.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      );
    });

    it("applies cursor pagination when a cursor is provided", async () => {
      vi.mocked(db.notification.findMany).mockResolvedValue([]);

      await notificationRepository.findByUser("user-1", 20, "cursor-id");

      expect(db.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: "cursor-id" },
          skip: 1,
        }),
      );
    });

    it("omits cursor when none is provided", async () => {
      vi.mocked(db.notification.findMany).mockResolvedValue([]);

      await notificationRepository.findByUser("user-1", 10);

      const call = vi.mocked(db.notification.findMany).mock.calls[0]![0]!;
      expect(call).not.toHaveProperty("cursor");
      expect(call).not.toHaveProperty("skip");
    });
  });

  // ── findRecentSystemForOrders ───────────────────────────────────────────────

  describe("findRecentSystemForOrders", () => {
    it("finds SYSTEM notifications for the given order IDs since cutoff", async () => {
      const since = new Date("2026-01-01");
      const mockRows = [{ orderId: "order-1" }, { orderId: "order-2" }];
      vi.mocked(db.notification.findMany).mockResolvedValue(mockRows as never);

      const result = await notificationRepository.findRecentSystemForOrders(
        ["order-1", "order-2"],
        since,
      );

      expect(result).toEqual(mockRows);
      expect(db.notification.findMany).toHaveBeenCalledWith({
        where: {
          orderId: { in: ["order-1", "order-2"] },
          type: "SYSTEM",
          createdAt: { gte: since },
        },
        select: { orderId: true },
      });
    });

    it("returns empty array when no matching notifications exist", async () => {
      vi.mocked(db.notification.findMany).mockResolvedValue([]);

      const result = await notificationRepository.findRecentSystemForOrders(
        ["order-99"],
        new Date(),
      );

      expect(result).toEqual([]);
    });
  });

  // ── notifyAdmins ────────────────────────────────────────────────────────────

  describe("notifyAdmins", () => {
    it("returns early without creating any notifications when no admins are found", async () => {
      // userRepository.findAdmins → db.user.findMany → []
      vi.mocked(db.user.findMany).mockResolvedValue([]);

      await notificationRepository.notifyAdmins({
        type: "SYSTEM",
        title: "New fraud report",
        body: "A user has been flagged for review",
      });

      expect(db.notification.create).not.toHaveBeenCalled();
    });

    it("creates one notification per admin via db.$transaction when admins exist", async () => {
      const admins = [
        { id: "admin-1", role: "ADMIN" },
        { id: "admin-2", role: "SUPER_ADMIN" },
      ];
      vi.mocked(db.user.findMany).mockResolvedValue(admins as never);
      // $transaction (array form) returns [] by default from setup.ts
      vi.mocked(db.notification.create).mockReturnValue({} as never);

      await notificationRepository.notifyAdmins({
        type: "SYSTEM",
        title: "Escalation",
        body: "Manual review required",
        link: "/admin/review",
      });

      // Verify create was called (once per admin, inside the transaction array)
      expect(db.notification.create).toHaveBeenCalledTimes(2);
      expect(db.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "admin-1",
            type: "SYSTEM",
            title: "Escalation",
          }),
        }),
      );
    });
  });
});
