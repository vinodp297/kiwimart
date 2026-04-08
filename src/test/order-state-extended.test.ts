// src/test/order-state-extended.test.ts
// ─── Tests: Order state machine — transitions, guards, concurrency ─────────
// Covers: all valid transitions, terminal state rejection, invalid transitions,
// optimistic locking, and concurrent modification detection.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";
import {
  transitionOrder,
  assertOrderTransition,
  VALID_ORDER_TRANSITIONS,
} from "@/modules/orders/order.transitions";

// ── Mock notification service ────────────────────────────────────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock order-event service ─────────────────────────────────────────────────
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    PAYMENT_HELD: "PAYMENT_HELD",
    DISPATCHED: "DISPATCHED",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    DELIVERY_CONFIRMED_OK: "DELIVERY_CONFIRMED_OK",
    DELIVERY_ISSUE_REPORTED: "DELIVERY_ISSUE_REPORTED",
  },
  ACTOR_ROLES: { SYSTEM: "SYSTEM", BUYER: "BUYER", SELLER: "SELLER" },
}));

// ── Mock order-interaction service ───────────────────────────────────────────
vi.mock("@/modules/orders/order-interaction.service", () => ({
  orderInteractionService: { createInteraction: vi.fn().mockResolvedValue({}) },
  INTERACTION_TYPES: { DELIVERY_ISSUE: "DELIVERY_ISSUE" },
  AUTO_ACTIONS: { AUTO_ESCALATE: "AUTO_ESCALATE" },
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("VALID_ORDER_TRANSITIONS — state machine definition", () => {
  it("defines terminal states with no outgoing edges", () => {
    expect(VALID_ORDER_TRANSITIONS.COMPLETED).toEqual([]);
    expect(VALID_ORDER_TRANSITIONS.REFUNDED).toEqual([]);
    expect(VALID_ORDER_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("AWAITING_PAYMENT can transition to PAYMENT_HELD, AWAITING_PICKUP, or CANCELLED", () => {
    expect(VALID_ORDER_TRANSITIONS.AWAITING_PAYMENT).toContain("PAYMENT_HELD");
    expect(VALID_ORDER_TRANSITIONS.AWAITING_PAYMENT).toContain(
      "AWAITING_PICKUP",
    );
    expect(VALID_ORDER_TRANSITIONS.AWAITING_PAYMENT).toContain("CANCELLED");
  });

  it("PAYMENT_HELD can transition to DISPATCHED, CANCELLED, or DISPUTED", () => {
    expect(VALID_ORDER_TRANSITIONS.PAYMENT_HELD).toContain("DISPATCHED");
    expect(VALID_ORDER_TRANSITIONS.PAYMENT_HELD).toContain("CANCELLED");
    expect(VALID_ORDER_TRANSITIONS.PAYMENT_HELD).toContain("DISPUTED");
  });

  it("AWAITING_PICKUP can transition to COMPLETED, CANCELLED, or DISPUTED", () => {
    expect(VALID_ORDER_TRANSITIONS.AWAITING_PICKUP).toContain("COMPLETED");
    expect(VALID_ORDER_TRANSITIONS.AWAITING_PICKUP).toContain("CANCELLED");
    expect(VALID_ORDER_TRANSITIONS.AWAITING_PICKUP).toContain("DISPUTED");
  });

  it("DISPATCHED can transition to DELIVERED, DISPUTED, or COMPLETED", () => {
    expect(VALID_ORDER_TRANSITIONS.DISPATCHED).toContain("DELIVERED");
    expect(VALID_ORDER_TRANSITIONS.DISPATCHED).toContain("DISPUTED");
    expect(VALID_ORDER_TRANSITIONS.DISPATCHED).toContain("COMPLETED");
  });

  it("DELIVERED can transition to COMPLETED or DISPUTED", () => {
    expect(VALID_ORDER_TRANSITIONS.DELIVERED).toContain("COMPLETED");
    expect(VALID_ORDER_TRANSITIONS.DELIVERED).toContain("DISPUTED");
  });

  it("DISPUTED can transition to COMPLETED, REFUNDED, or CANCELLED", () => {
    expect(VALID_ORDER_TRANSITIONS.DISPUTED).toContain("COMPLETED");
    expect(VALID_ORDER_TRANSITIONS.DISPUTED).toContain("REFUNDED");
    expect(VALID_ORDER_TRANSITIONS.DISPUTED).toContain("CANCELLED");
  });
});

describe("assertOrderTransition — validation", () => {
  it("allows valid AWAITING_PAYMENT → PAYMENT_HELD", () => {
    expect(() =>
      assertOrderTransition("order-1", "AWAITING_PAYMENT", "PAYMENT_HELD"),
    ).not.toThrow();
  });

  it("allows valid PAYMENT_HELD → DISPATCHED", () => {
    expect(() =>
      assertOrderTransition("order-1", "PAYMENT_HELD", "DISPATCHED"),
    ).not.toThrow();
  });

  it("allows valid DISPATCHED → DELIVERED", () => {
    expect(() =>
      assertOrderTransition("order-1", "DISPATCHED", "DELIVERED"),
    ).not.toThrow();
  });

  it("allows valid DELIVERED → COMPLETED", () => {
    expect(() =>
      assertOrderTransition("order-1", "DELIVERED", "COMPLETED"),
    ).not.toThrow();
  });

  it("allows valid DISPUTED → REFUNDED", () => {
    expect(() =>
      assertOrderTransition("order-1", "DISPUTED", "REFUNDED"),
    ).not.toThrow();
  });

  it("throws for COMPLETED → any state (terminal)", () => {
    for (const target of [
      "DISPATCHED",
      "PENDING",
      "CANCELLED",
      "REFUNDED",
      "DISPUTED",
    ]) {
      expect(() =>
        assertOrderTransition("order-1", "COMPLETED", target),
      ).toThrow(/Invalid order transition.*COMPLETED/);
    }
  });

  it("throws for CANCELLED → any state (terminal)", () => {
    for (const target of [
      "PAYMENT_HELD",
      "DISPATCHED",
      "COMPLETED",
      "REFUNDED",
    ]) {
      expect(() =>
        assertOrderTransition("order-1", "CANCELLED", target),
      ).toThrow(/Invalid order transition.*CANCELLED/);
    }
  });

  it("throws for REFUNDED → any state (terminal)", () => {
    expect(() =>
      assertOrderTransition("order-1", "REFUNDED", "COMPLETED"),
    ).toThrow(/Invalid order transition.*REFUNDED/);
  });

  it("throws for backwards transition DELIVERED → PENDING", () => {
    expect(() =>
      assertOrderTransition("order-1", "DELIVERED", "PENDING"),
    ).toThrow(/Invalid order transition/);
  });

  it("throws for DISPATCHED → AWAITING_PAYMENT (backwards)", () => {
    expect(() =>
      assertOrderTransition("order-1", "DISPATCHED", "AWAITING_PAYMENT"),
    ).toThrow(/Invalid order transition/);
  });

  it("throws for unknown source status", () => {
    expect(() =>
      assertOrderTransition("order-1", "UNKNOWN", "COMPLETED"),
    ).toThrow(/Invalid order transition/);
  });
});

describe("transitionOrder — execution with optimistic locking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
  });

  it("transitions AWAITING_PAYMENT → PAYMENT_HELD with fromStatus", async () => {
    await transitionOrder(
      "order-1",
      "PAYMENT_HELD",
      { updatedAt: new Date() },
      { fromStatus: "AWAITING_PAYMENT" },
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "order-1",
          status: "AWAITING_PAYMENT",
        }),
        data: expect.objectContaining({ status: "PAYMENT_HELD" }),
      }),
    );
  });

  it("transitions PAYMENT_HELD → DISPATCHED", async () => {
    await transitionOrder(
      "order-1",
      "DISPATCHED",
      { dispatchedAt: new Date() },
      { fromStatus: "PAYMENT_HELD" },
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DISPATCHED" }),
      }),
    );
  });

  it("transitions DISPATCHED → DELIVERED", async () => {
    await transitionOrder(
      "order-1",
      "DELIVERED",
      {},
      {
        fromStatus: "DISPATCHED",
      },
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DELIVERED" }),
      }),
    );
  });

  it("transitions DELIVERED → COMPLETED", async () => {
    await transitionOrder(
      "order-1",
      "COMPLETED",
      { completedAt: new Date() },
      { fromStatus: "DELIVERED" },
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("transitions PAYMENT_HELD → CANCELLED", async () => {
    await transitionOrder(
      "order-1",
      "CANCELLED",
      { cancelledAt: new Date() },
      { fromStatus: "PAYMENT_HELD" },
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("transitions PAYMENT_HELD → DISPUTED", async () => {
    await transitionOrder(
      "order-1",
      "DISPUTED",
      {},
      {
        fromStatus: "PAYMENT_HELD",
      },
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DISPUTED" }),
      }),
    );
  });

  it("transitions DISPUTED → COMPLETED (after resolution)", async () => {
    await transitionOrder(
      "order-1",
      "COMPLETED",
      { completedAt: new Date() },
      { fromStatus: "DISPUTED" },
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("transitions DISPUTED → REFUNDED", async () => {
    await transitionOrder(
      "order-1",
      "REFUNDED",
      {},
      {
        fromStatus: "DISPUTED",
      },
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REFUNDED" }),
      }),
    );
  });

  it("transitions AWAITING_PICKUP → COMPLETED (OTP confirmed)", async () => {
    await transitionOrder(
      "order-1",
      "COMPLETED",
      { completedAt: new Date() },
      { fromStatus: "AWAITING_PICKUP" },
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("fetches current status when fromStatus not provided", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: "order-1",
      status: "PAYMENT_HELD",
    } as never);

    await transitionOrder("order-1", "DISPATCHED", {});

    expect(db.order.findUnique).toHaveBeenCalled();
    expect(db.order.updateMany).toHaveBeenCalled();
  });

  it("throws AppError.notFound when order not found and no fromStatus", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(null);

    await expect(
      transitionOrder("order-nonexistent", "DISPATCHED", {}),
    ).rejects.toThrow();
  });

  // ── Invalid transitions ─────────────────────────────────────────────────

  it("throws on invalid transition COMPLETED → DISPATCHED", async () => {
    await expect(
      transitionOrder(
        "order-1",
        "DISPATCHED",
        {},
        {
          fromStatus: "COMPLETED",
        },
      ),
    ).rejects.toThrow(/Invalid order transition/);
  });

  it("throws on invalid transition CANCELLED → PAYMENT_HELD", async () => {
    await expect(
      transitionOrder(
        "order-1",
        "PAYMENT_HELD",
        {},
        {
          fromStatus: "CANCELLED",
        },
      ),
    ).rejects.toThrow(/Invalid order transition/);
  });

  it("throws on backwards transition DELIVERED → PENDING", async () => {
    await expect(
      transitionOrder(
        "order-1",
        "PENDING",
        {},
        {
          fromStatus: "DELIVERED",
        },
      ),
    ).rejects.toThrow(/Invalid order transition/);
  });

  // ── Concurrent modification ─────────────────────────────────────────────

  it("throws P2025 error when optimistic lock fails (count=0)", async () => {
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 0 });

    await expect(
      transitionOrder(
        "order-1",
        "DISPATCHED",
        {},
        {
          fromStatus: "PAYMENT_HELD",
        },
      ),
    ).rejects.toThrow(/concurrent modification/);
  });

  it("concurrent modification error has code P2025", async () => {
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 0 });

    try {
      await transitionOrder(
        "order-1",
        "DISPATCHED",
        {},
        {
          fromStatus: "PAYMENT_HELD",
        },
      );
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("P2025");
    }
  });

  it("includes transition data in the update", async () => {
    const dispatchedAt = new Date("2026-04-01");
    await transitionOrder(
      "order-1",
      "DISPATCHED",
      { dispatchedAt, trackingNumber: "NZ123" },
      { fromStatus: "PAYMENT_HELD" },
    );

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DISPATCHED",
          dispatchedAt,
          trackingNumber: "NZ123",
        }),
      }),
    );
  });
});
