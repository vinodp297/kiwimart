// src/test/cron-lock.test.ts
// ─── Tests: cron job distributed lock behaviour ───────────────────────────────
// Verifies that processDeliveryReminders uses acquireLock/releaseLock correctly:
//   1. Lock is acquired before processing starts
//   2. Lock is released after processing completes
//   3. A second concurrent call is skipped when the lock is held
//   4. Reminders are not sent twice when the lock prevents a second run

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock distributedLock ──────────────────────────────────────────────────────

const mockAcquireLock = vi.fn();
const mockReleaseLock = vi.fn();

vi.mock("@/server/lib/distributedLock", () => ({
  acquireLock: (...args: unknown[]) => mockAcquireLock(...args),
  releaseLock: (...args: unknown[]) => mockReleaseLock(...args),
}));

// ── Mock db ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  default: {
    order: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    orderEvent: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn().mockImplementation(async (fnOrArray: unknown) => {
      if (typeof fnOrArray === "function") return fnOrArray({});
      if (Array.isArray(fnOrArray)) return Promise.all(fnOrArray);
    }),
  },
}));

// ── Mock paymentService & other dependencies ──────────────────────────────────

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: { capturePayment: vi.fn() },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn(),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: vi.fn(),
}));

vi.mock("@/lib/smartNotifications", () => ({
  notifyBuyerDeliveryOverdue: vi.fn(),
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    DELIVERY_REMINDER_SENT: "DELIVERY_REMINDER_SENT",
    AUTO_COMPLETED: "AUTO_COMPLETED",
  },
  ACTOR_ROLES: { SYSTEM: "SYSTEM" },
}));

vi.mock("@/server/lib/audit", () => ({
  audit: vi.fn(),
}));

// ── Import job after mocks ────────────────────────────────────────────────────

const { processDeliveryReminders } =
  await import("@/server/jobs/deliveryReminders");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("processDeliveryReminders — distributed lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReleaseLock.mockResolvedValue(undefined);
  });

  it("acquires lock before processing", async () => {
    mockAcquireLock.mockResolvedValue("lock-value-abc");

    await processDeliveryReminders();

    expect(mockAcquireLock).toHaveBeenCalledWith(
      "cron:delivery-reminders",
      expect.any(Number),
    );
  });

  it("releases lock after processing completes", async () => {
    const lockValue = "lock-value-xyz";
    mockAcquireLock.mockResolvedValue(lockValue);

    await processDeliveryReminders();

    expect(mockReleaseLock).toHaveBeenCalledWith(
      "cron:delivery-reminders",
      lockValue,
    );
  });

  it("skips processing and returns skipped:true when lock is already held", async () => {
    mockAcquireLock.mockResolvedValue(null); // lock held by another instance

    const result = await processDeliveryReminders();

    expect(result).toEqual({
      remindersSent: 0,
      autoCompleted: 0,
      errors: 0,
      skipped: true,
    });
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });

  it("does not send reminders when second call is blocked by lock", async () => {
    const { notifyBuyerDeliveryOverdue } =
      await import("@/lib/smartNotifications");

    // First call acquires the lock; second call finds it held
    mockAcquireLock
      .mockResolvedValueOnce("lock-1") // first call succeeds
      .mockResolvedValueOnce(null); // second call is blocked

    await processDeliveryReminders(); // first run
    const second = await processDeliveryReminders(); // blocked

    expect(second.skipped).toBe(true);
    // notifyBuyerDeliveryOverdue was called at most once (from first run, 0 orders)
    expect(notifyBuyerDeliveryOverdue).not.toHaveBeenCalled();
  });
});
