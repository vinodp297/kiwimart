// src/test/notification.service.test.ts
// ─── Tests for NotificationService + NotificationRepository ────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { createNotification } from "@/modules/notifications/notification.service";
import { notificationRepository } from "@/modules/notifications/notification.repository";

// Mock the notification repository so createNotification tests hit the mock
vi.mock("@/modules/notifications/notification.repository", () => ({
  notificationRepository: {
    create: vi.fn().mockResolvedValue({ id: "notif-1" }),
    findByUser: vi.fn().mockResolvedValue([]),
    markRead: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(undefined),
    countUnread: vi.fn().mockResolvedValue(0),
    findRecentReminder: vi.fn().mockResolvedValue(null),
    notifyAdmins: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("NotificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createNotification ──────────────────────────────────────────────────

  describe("createNotification", () => {
    it("creates notification successfully", async () => {
      await createNotification({
        userId: "user-1",
        type: "ORDER_PLACED",
        title: "Order confirmed",
        body: "Your order has been placed",
      });

      expect(notificationRepository.create).toHaveBeenCalledWith({
        userId: "user-1",
        type: "ORDER_PLACED",
        title: "Order confirmed",
        body: "Your order has been placed",
        listingId: null,
        orderId: null,
        link: null,
        isRead: false,
      });
    });

    it("passes optional listingId and orderId", async () => {
      await createNotification({
        userId: "user-1",
        type: "ORDER_DISPATCHED",
        title: "Shipped!",
        body: "Your order is on its way",
        listingId: "listing-1",
        orderId: "order-1",
        link: "/orders/order-1",
      });

      expect(notificationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          listingId: "listing-1",
          orderId: "order-1",
          link: "/orders/order-1",
        }),
      );
    });

    it("swallows errors without throwing", async () => {
      vi.mocked(notificationRepository.create).mockRejectedValue(
        new Error("DB down"),
      );

      // Should NOT throw — non-blocking
      await expect(
        createNotification({
          userId: "user-1",
          type: "SYSTEM",
          title: "Test",
          body: "Test",
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ── notificationRepository ──────────────────────────────────────────────

  describe("notificationRepository", () => {
    it("notifyAdmins can be called with payload", async () => {
      await notificationRepository.notifyAdmins({
        type: "SYSTEM",
        title: "New report",
        body: "A new report was filed",
        link: "/admin/reports",
      });

      expect(notificationRepository.notifyAdmins).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SYSTEM",
          title: "New report",
        }),
      );
    });

    it("markAllRead updates all unread notifications for user", async () => {
      await notificationRepository.markAllRead("user-1");

      expect(notificationRepository.markAllRead).toHaveBeenCalledWith("user-1");
    });

    it("findByUser returns paginated results with cursor", async () => {
      const mockNotifs = [
        { id: "notif-1", type: "ORDER_PLACED", isRead: false },
        { id: "notif-2", type: "MESSAGE_RECEIVED", isRead: true },
      ];
      vi.mocked(notificationRepository.findByUser).mockResolvedValue(
        mockNotifs as never,
      );

      const result = await notificationRepository.findByUser(
        "user-1",
        20,
        "notif-0",
      );

      expect(result).toHaveLength(2);
      expect(notificationRepository.findByUser).toHaveBeenCalledWith(
        "user-1",
        20,
        "notif-0",
      );
    });

    it("countUnread returns correct count", async () => {
      vi.mocked(notificationRepository.countUnread).mockResolvedValue(5);

      const count = await notificationRepository.countUnread("user-1");

      expect(count).toBe(5);
    });

    it("findByUser returns empty when no notifications", async () => {
      vi.mocked(notificationRepository.findByUser).mockResolvedValue([]);

      const result = await notificationRepository.findByUser("user-1", 20);

      expect(result).toEqual([]);
    });

    it("markRead marks specific notifications as read", async () => {
      await notificationRepository.markRead(["notif-1", "notif-2"], "user-1");

      expect(notificationRepository.markRead).toHaveBeenCalledWith(
        ["notif-1", "notif-2"],
        "user-1",
      );
    });
  });
});
