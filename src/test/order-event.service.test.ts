// src/test/order-event.service.test.ts
// ─── Tests for OrderEventService ────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";

// Mock order repository
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    createEvent: vi.fn().mockResolvedValue({ id: "evt-1" }),
    findEventsByOrderId: vi.fn().mockResolvedValue([]),
    findByIdForTransition: vi.fn(),
    updateStatusOptimistic: vi.fn(),
  },
}));

import { orderRepository } from "@/modules/orders/order.repository";

describe("OrderEventService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── ORDER_EVENT_TYPES ────────────────────────────────────────────────────

  describe("ORDER_EVENT_TYPES", () => {
    it("exports all expected event types", () => {
      expect(ORDER_EVENT_TYPES.ORDER_CREATED).toBe("ORDER_CREATED");
      expect(ORDER_EVENT_TYPES.PAYMENT_HELD).toBe("PAYMENT_HELD");
      expect(ORDER_EVENT_TYPES.DISPATCHED).toBe("DISPATCHED");
      expect(ORDER_EVENT_TYPES.COMPLETED).toBe("COMPLETED");
      expect(ORDER_EVENT_TYPES.DISPUTE_OPENED).toBe("DISPUTE_OPENED");
      expect(ORDER_EVENT_TYPES.REFUNDED).toBe("REFUNDED");
      expect(ORDER_EVENT_TYPES.CANCELLED).toBe("CANCELLED");
      expect(ORDER_EVENT_TYPES.REVIEW_SUBMITTED).toBe("REVIEW_SUBMITTED");
    });
  });

  // ── ACTOR_ROLES ──────────────────────────────────────────────────────────

  describe("ACTOR_ROLES", () => {
    it("exports all actor roles", () => {
      expect(ACTOR_ROLES.BUYER).toBe("BUYER");
      expect(ACTOR_ROLES.SELLER).toBe("SELLER");
      expect(ACTOR_ROLES.ADMIN).toBe("ADMIN");
      expect(ACTOR_ROLES.SYSTEM).toBe("SYSTEM");
    });
  });

  // ── recordEvent ──────────────────────────────────────────────────────────

  describe("recordEvent", () => {
    it("records event via repository", async () => {
      orderEventService.recordEvent({
        orderId: "order-1",
        type: ORDER_EVENT_TYPES.ORDER_CREATED,
        actorId: "user-1",
        actorRole: ACTOR_ROLES.BUYER,
        summary: "Order placed",
      });

      // Wait for fire-and-forget
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(orderRepository.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: "order-1",
          type: "ORDER_CREATED",
          actorId: "user-1",
          actorRole: "BUYER",
          summary: "Order placed",
        }),
      );
    });

    it("handles null actorId", async () => {
      orderEventService.recordEvent({
        orderId: "order-1",
        type: ORDER_EVENT_TYPES.AUTO_COMPLETED,
        actorId: null,
        actorRole: ACTOR_ROLES.SYSTEM,
        summary: "Auto-completed after delivery confirmation",
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(orderRepository.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: null,
          actorRole: "SYSTEM",
        }),
      );
    });

    it("passes metadata to repository", async () => {
      orderEventService.recordEvent({
        orderId: "order-1",
        type: ORDER_EVENT_TYPES.REVIEW_SUBMITTED,
        actorId: "user-1",
        actorRole: ACTOR_ROLES.BUYER,
        summary: "Buyer left 5-star review",
        metadata: { reviewId: "review-1", rating: 5 },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(orderRepository.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { reviewId: "review-1", rating: 5 },
        }),
      );
    });

    it("silently catches repository errors", async () => {
      vi.mocked(orderRepository.createEvent).mockRejectedValue(
        new Error("DB down"),
      );

      // Should NOT throw
      expect(() =>
        orderEventService.recordEvent({
          orderId: "order-1",
          type: ORDER_EVENT_TYPES.ORDER_CREATED,
          actorId: "user-1",
          actorRole: ACTOR_ROLES.BUYER,
          summary: "Order placed",
        }),
      ).not.toThrow();

      // Wait for the promise to settle
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });

  // ── getOrderTimeline ─────────────────────────────────────────────────────

  describe("getOrderTimeline", () => {
    it("returns events from repository", async () => {
      const mockEvents = [
        { id: "evt-1", type: "ORDER_CREATED", summary: "Order placed" },
        { id: "evt-2", type: "DISPATCHED", summary: "Seller dispatched" },
      ];
      vi.mocked(orderRepository.findEventsByOrderId).mockResolvedValue(
        mockEvents as never,
      );

      const result = await orderEventService.getOrderTimeline("order-1");

      expect(result).toHaveLength(2);
      expect(orderRepository.findEventsByOrderId).toHaveBeenCalledWith(
        "order-1",
      );
    });

    it("returns empty array when no events", async () => {
      vi.mocked(orderRepository.findEventsByOrderId).mockResolvedValue([]);

      const result = await orderEventService.getOrderTimeline("order-1");

      expect(result).toEqual([]);
    });
  });
});
