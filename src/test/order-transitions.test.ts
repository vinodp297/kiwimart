// src/test/order-transitions.test.ts
// ─── Tests for Order State Machine ──────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import {
  assertOrderTransition,
  transitionOrder,
  VALID_ORDER_TRANSITIONS,
} from "@/modules/orders/order.transitions";
import { AppError } from "@/shared/errors";

// Mock order repository
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findByIdForTransition: vi.fn(),
    updateStatusOptimistic: vi.fn().mockResolvedValue({ count: 1 }),
    createEvent: vi.fn().mockResolvedValue({ id: "evt-1" }),
    findEventsByOrderId: vi.fn().mockResolvedValue([]),
  },
}));

import { orderRepository } from "@/modules/orders/order.repository";

describe("Order State Machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(orderRepository.updateStatusOptimistic).mockResolvedValue({
      count: 1,
    } as never);
  });

  // ── assertOrderTransition ────────────────────────────────────────────────

  describe("assertOrderTransition", () => {
    it("allows AWAITING_PAYMENT → PAYMENT_HELD", () => {
      expect(() =>
        assertOrderTransition("o-1", "AWAITING_PAYMENT", "PAYMENT_HELD"),
      ).not.toThrow();
    });

    it("allows AWAITING_PAYMENT → CANCELLED", () => {
      expect(() =>
        assertOrderTransition("o-1", "AWAITING_PAYMENT", "CANCELLED"),
      ).not.toThrow();
    });

    it("allows PAYMENT_HELD → DISPATCHED", () => {
      expect(() =>
        assertOrderTransition("o-1", "PAYMENT_HELD", "DISPATCHED"),
      ).not.toThrow();
    });

    it("allows DISPATCHED → DELIVERED", () => {
      expect(() =>
        assertOrderTransition("o-1", "DISPATCHED", "DELIVERED"),
      ).not.toThrow();
    });

    it("allows DELIVERED → COMPLETED", () => {
      expect(() =>
        assertOrderTransition("o-1", "DELIVERED", "COMPLETED"),
      ).not.toThrow();
    });

    it("allows DISPUTED → REFUNDED", () => {
      expect(() =>
        assertOrderTransition("o-1", "DISPUTED", "REFUNDED"),
      ).not.toThrow();
    });

    it("allows AWAITING_PAYMENT → AWAITING_PICKUP (cash-on-pickup)", () => {
      expect(() =>
        assertOrderTransition("o-1", "AWAITING_PAYMENT", "AWAITING_PICKUP"),
      ).not.toThrow();
    });

    it("allows AWAITING_PICKUP → COMPLETED", () => {
      expect(() =>
        assertOrderTransition("o-1", "AWAITING_PICKUP", "COMPLETED"),
      ).not.toThrow();
    });

    it("allows AWAITING_PICKUP → CANCELLED", () => {
      expect(() =>
        assertOrderTransition("o-1", "AWAITING_PICKUP", "CANCELLED"),
      ).not.toThrow();
    });

    it("allows AWAITING_PICKUP → DISPUTED", () => {
      expect(() =>
        assertOrderTransition("o-1", "AWAITING_PICKUP", "DISPUTED"),
      ).not.toThrow();
    });

    it("allows PAYMENT_HELD → DISPUTED", () => {
      expect(() =>
        assertOrderTransition("o-1", "PAYMENT_HELD", "DISPUTED"),
      ).not.toThrow();
    });

    it("allows PAYMENT_HELD → CANCELLED", () => {
      expect(() =>
        assertOrderTransition("o-1", "PAYMENT_HELD", "CANCELLED"),
      ).not.toThrow();
    });

    it("allows DISPATCHED → DISPUTED", () => {
      expect(() =>
        assertOrderTransition("o-1", "DISPATCHED", "DISPUTED"),
      ).not.toThrow();
    });

    it("allows DISPATCHED → COMPLETED", () => {
      expect(() =>
        assertOrderTransition("o-1", "DISPATCHED", "COMPLETED"),
      ).not.toThrow();
    });

    it("allows DELIVERED → DISPUTED", () => {
      expect(() =>
        assertOrderTransition("o-1", "DELIVERED", "DISPUTED"),
      ).not.toThrow();
    });

    it("allows DISPUTED → COMPLETED", () => {
      expect(() =>
        assertOrderTransition("o-1", "DISPUTED", "COMPLETED"),
      ).not.toThrow();
    });

    it("allows DISPUTED → CANCELLED", () => {
      expect(() =>
        assertOrderTransition("o-1", "DISPUTED", "CANCELLED"),
      ).not.toThrow();
    });

    it("rejects COMPLETED → anything (terminal state)", () => {
      expect(() =>
        assertOrderTransition("o-1", "COMPLETED", "DISPATCHED"),
      ).toThrow("Invalid order transition");
    });

    it("rejects REFUNDED → anything (terminal state)", () => {
      expect(() =>
        assertOrderTransition("o-1", "REFUNDED", "COMPLETED"),
      ).toThrow("terminal state");
    });

    it("rejects CANCELLED → anything (terminal state)", () => {
      expect(() =>
        assertOrderTransition("o-1", "CANCELLED", "DISPATCHED"),
      ).toThrow("terminal state");
    });

    it("rejects backwards transition DISPATCHED → PAYMENT_HELD", () => {
      expect(() =>
        assertOrderTransition("o-1", "DISPATCHED", "PAYMENT_HELD"),
      ).toThrow("Invalid order transition");
    });

    it("rejects unknown status", () => {
      expect(() =>
        assertOrderTransition("o-1", "NONEXISTENT", "COMPLETED"),
      ).toThrow("Invalid order transition");
    });

    it("includes allowed transitions in error message", () => {
      expect(() =>
        assertOrderTransition("o-1", "PAYMENT_HELD", "COMPLETED"),
      ).toThrow("Allowed: DISPATCHED, CANCELLED, DISPUTED");
    });
  });

  // ── VALID_ORDER_TRANSITIONS ──────────────────────────────────────────────

  describe("VALID_ORDER_TRANSITIONS", () => {
    it("defines 9 statuses", () => {
      expect(Object.keys(VALID_ORDER_TRANSITIONS)).toHaveLength(9);
    });

    it("has 3 terminal states with no outgoing edges", () => {
      expect(VALID_ORDER_TRANSITIONS.COMPLETED).toEqual([]);
      expect(VALID_ORDER_TRANSITIONS.REFUNDED).toEqual([]);
      expect(VALID_ORDER_TRANSITIONS.CANCELLED).toEqual([]);
    });

    it("all transitions reference valid states", () => {
      const allStates = Object.keys(VALID_ORDER_TRANSITIONS);
      for (const [_from, tos] of Object.entries(VALID_ORDER_TRANSITIONS)) {
        for (const to of tos) {
          expect(allStates).toContain(to);
        }
      }
    });
  });

  // ── transitionOrder ──────────────────────────────────────────────────────

  describe("transitionOrder", () => {
    it("transitions order successfully with fromStatus provided", async () => {
      await transitionOrder(
        "o-1",
        "DISPATCHED",
        {},
        {
          fromStatus: "PAYMENT_HELD",
        },
      );

      expect(orderRepository.updateStatusOptimistic).toHaveBeenCalledWith(
        "o-1",
        "PAYMENT_HELD",
        "DISPATCHED",
        {},
        undefined,
      );
    });

    it("fetches current status when fromStatus not provided", async () => {
      vi.mocked(orderRepository.findByIdForTransition).mockResolvedValue({
        id: "o-1",
        status: "PAYMENT_HELD",
      } as never);

      await transitionOrder("o-1", "DISPATCHED");

      expect(orderRepository.findByIdForTransition).toHaveBeenCalledWith(
        "o-1",
        undefined,
      );
    });

    it("throws NOT_FOUND when order does not exist", async () => {
      vi.mocked(orderRepository.findByIdForTransition).mockResolvedValue(null);

      await expect(transitionOrder("o-1", "DISPATCHED")).rejects.toThrow(
        AppError,
      );
    });

    it("throws P2025 on concurrent modification (count=0)", async () => {
      vi.mocked(orderRepository.updateStatusOptimistic).mockResolvedValue({
        count: 0,
      } as never);

      await expect(
        transitionOrder(
          "o-1",
          "DISPATCHED",
          {},
          {
            fromStatus: "PAYMENT_HELD",
          },
        ),
      ).rejects.toThrow("concurrent modification");
    });

    it("passes transition data to repository", async () => {
      await transitionOrder(
        "o-1",
        "COMPLETED",
        { completedAt: new Date("2026-01-01") },
        { fromStatus: "DELIVERED" },
      );

      expect(orderRepository.updateStatusOptimistic).toHaveBeenCalledWith(
        "o-1",
        "DELIVERED",
        "COMPLETED",
        expect.objectContaining({ completedAt: expect.any(Date) }),
        undefined,
      );
    });

    it("passes tx to repository when provided", async () => {
      const mockTx = { order: {} } as never;

      await transitionOrder(
        "o-1",
        "DISPATCHED",
        {},
        {
          fromStatus: "PAYMENT_HELD",
          tx: mockTx,
        },
      );

      expect(orderRepository.updateStatusOptimistic).toHaveBeenCalledWith(
        "o-1",
        "PAYMENT_HELD",
        "DISPATCHED",
        {},
        mockTx,
      );
    });

    it("rejects invalid transitions without hitting DB", async () => {
      await expect(
        transitionOrder(
          "o-1",
          "PAYMENT_HELD",
          {},
          {
            fromStatus: "COMPLETED",
          },
        ),
      ).rejects.toThrow("Invalid order transition");

      expect(orderRepository.updateStatusOptimistic).not.toHaveBeenCalled();
    });
  });
});
