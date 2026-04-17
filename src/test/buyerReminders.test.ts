// src/test/buyerReminders.test.ts
// ─── Tests: Buyer Delivery Reminder Cron Job ────────────────────────────────
// Covers sendDeliveryReminders: distributed lock, day-2 + day-3 email windows,
// Promise.allSettled error isolation, logger audit entries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock order repository ─────────────────────────────────────────────────────
const mockFindDispatchedInWindow = vi.fn();
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findDispatchedInWindow: (...args: unknown[]) =>
      mockFindDispatchedInWindow(...args),
  },
}));

// ── Mock email senders ───────────────────────────────────────────────────────
const mockSendDay2Email = vi.fn();
const mockSendDay3Email = vi.fn();
vi.mock("@/server/email", () => ({
  sendDeliveryReminderEmail: (...args: unknown[]) => mockSendDay2Email(...args),
  sendFinalDeliveryReminderEmail: (...args: unknown[]) =>
    mockSendDay3Email(...args),
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { sendDeliveryReminders } = await import("@/server/jobs/buyerReminders");
const { logger } = await import("@/shared/logger");
const { acquireLock, releaseLock } =
  await import("@/server/lib/distributedLock");

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeOrder(id: string, trackingNumber: string | null = null) {
  return {
    id,
    trackingNumber,
    buyer: { email: `buyer_${id}@test.com`, displayName: `Buyer ${id}` },
    listing: { title: `Listing ${id}` },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("sendDeliveryReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(acquireLock).mockResolvedValue("lock_value");
    vi.mocked(releaseLock).mockResolvedValue(undefined);
    mockFindDispatchedInWindow.mockResolvedValue([]);
    mockSendDay2Email.mockResolvedValue(undefined);
    mockSendDay3Email.mockResolvedValue(undefined);
  });

  it("skips when another instance already holds the lock", async () => {
    vi.mocked(acquireLock).mockResolvedValueOnce(null);

    await sendDeliveryReminders();

    expect(logger.info).toHaveBeenCalledWith(
      "buyer_reminders.skipped_lock_held",
      expect.any(Object),
    );
    expect(mockFindDispatchedInWindow).not.toHaveBeenCalled();
    expect(mockSendDay2Email).not.toHaveBeenCalled();
    expect(mockSendDay3Email).not.toHaveBeenCalled();
  });

  it("queries two delivery windows (day-2 and day-3)", async () => {
    await sendDeliveryReminders();

    expect(mockFindDispatchedInWindow).toHaveBeenCalledTimes(2);
    // Day 3 window uses earlier dates than day 2 window
    const day2Call = mockFindDispatchedInWindow.mock.calls[0] as [Date, Date];
    const day3Call = mockFindDispatchedInWindow.mock.calls[1] as [Date, Date];
    expect(day3Call[0].getTime()).toBeLessThan(day2Call[0].getTime());
  });

  it("sends day-2 reminder with daysRemaining=2", async () => {
    mockFindDispatchedInWindow
      .mockResolvedValueOnce([makeOrder("o1")]) // day 2
      .mockResolvedValueOnce([]); // day 3

    await sendDeliveryReminders();

    expect(mockSendDay2Email).toHaveBeenCalledTimes(1);
    expect(mockSendDay2Email).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer_o1@test.com",
        buyerName: "Buyer o1",
        listingTitle: "Listing o1",
        orderId: "o1",
        daysRemaining: 2,
      }),
    );
    expect(mockSendDay3Email).not.toHaveBeenCalled();
  });

  it("sends day-3 reminder with daysRemaining=1", async () => {
    mockFindDispatchedInWindow
      .mockResolvedValueOnce([]) // day 2
      .mockResolvedValueOnce([makeOrder("o2", "TRACK123")]); // day 3

    await sendDeliveryReminders();

    expect(mockSendDay3Email).toHaveBeenCalledTimes(1);
    expect(mockSendDay3Email).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "o2",
        trackingNumber: "TRACK123",
        daysRemaining: 1,
      }),
    );
  });

  it("per-order email failure is logged and other orders still proceed", async () => {
    mockFindDispatchedInWindow
      .mockResolvedValueOnce([
        makeOrder("ok1"),
        makeOrder("bad"),
        makeOrder("ok2"),
      ])
      .mockResolvedValueOnce([]);
    mockSendDay2Email
      .mockResolvedValueOnce(undefined) // ok1
      .mockRejectedValueOnce(new Error("SMTP down")) // bad
      .mockResolvedValueOnce(undefined); // ok2

    await sendDeliveryReminders();

    expect(mockSendDay2Email).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith(
      "reminders.day2.failed",
      expect.objectContaining({ orderId: "bad" }),
    );
  });

  it("day-3 email failure is logged with day3 prefix", async () => {
    mockFindDispatchedInWindow
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeOrder("bad3")]);
    mockSendDay3Email.mockRejectedValueOnce(new Error("Boom"));

    await sendDeliveryReminders();

    expect(logger.error).toHaveBeenCalledWith(
      "reminders.day3.failed",
      expect.objectContaining({ orderId: "bad3" }),
    );
  });

  it("records completion metrics in logger", async () => {
    mockFindDispatchedInWindow
      .mockResolvedValueOnce([makeOrder("a"), makeOrder("b")])
      .mockResolvedValueOnce([makeOrder("c")]);

    await sendDeliveryReminders();

    expect(logger.info).toHaveBeenCalledWith(
      "reminders.complete",
      expect.objectContaining({
        day2: { total: 2, sent: 2 },
        day3: { total: 1, sent: 1 },
      }),
    );
  });

  it("always releases lock even if repository throws", async () => {
    mockFindDispatchedInWindow.mockRejectedValueOnce(new Error("DB down"));

    await expect(sendDeliveryReminders()).rejects.toThrow();
    expect(releaseLock).toHaveBeenCalled();
  });

  it("no dispatched orders → sends no emails but completes cleanly", async () => {
    await sendDeliveryReminders();

    expect(mockSendDay2Email).not.toHaveBeenCalled();
    expect(mockSendDay3Email).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "reminders.complete",
      expect.any(Object),
    );
  });

  it("passes confirmUrl based on NEXT_PUBLIC_APP_URL fallback", async () => {
    mockFindDispatchedInWindow
      .mockResolvedValueOnce([makeOrder("o1")])
      .mockResolvedValueOnce([]);

    await sendDeliveryReminders();

    const call = mockSendDay2Email.mock.calls[0]?.[0] as {
      confirmUrl: string;
    };
    expect(call.confirmUrl).toMatch(/\/dashboard\/buyer$/);
  });
});
