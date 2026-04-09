// src/test/order-interaction.service.test.ts
// ─── OrderInteractionService — buyer-seller negotiations ────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock interaction repository ─────────────────────────────────────────────
const mockFindOrderForInteraction = vi.fn();
const mockFindPendingByTypeAndOrder = vi.fn();
const mockCreateInteraction = vi.fn();
const mockFindByIdWithOrder = vi.fn();
const mockUpdateInteraction = vi.fn();
const mockFindActiveByOrder = vi.fn();
const mockFindAllByOrder = vi.fn();

vi.mock("@/modules/orders/interaction.repository", () => ({
  interactionRepository: {
    findOrderForInteraction: (...a: unknown[]) =>
      mockFindOrderForInteraction(...a),
    findPendingByTypeAndOrder: (...a: unknown[]) =>
      mockFindPendingByTypeAndOrder(...a),
    createInteraction: (...a: unknown[]) => mockCreateInteraction(...a),
    findByIdWithOrder: (...a: unknown[]) => mockFindByIdWithOrder(...a),
    updateInteraction: (...a: unknown[]) => mockUpdateInteraction(...a),
    findActiveByOrder: (...a: unknown[]) => mockFindActiveByOrder(...a),
    findAllByOrder: (...a: unknown[]) => mockFindAllByOrder(...a),
  },
}));

import {
  OrderInteractionService,
  INTERACTION_TYPES,
  INTERACTION_STATUSES,
} from "@/modules/orders/order-interaction.service";

const service = new OrderInteractionService();

const BASE_INPUT = {
  orderId: "order-1",
  type: INTERACTION_TYPES.CANCEL_REQUEST,
  initiatedById: "buyer-1",
  initiatorRole: "BUYER" as const,
  reason: "Changed my mind",
  expiresAt: new Date("2026-12-01"),
  autoAction: "AUTO_APPROVE",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// createInteraction
// ═══════════════════════════════════════════════════════════════════════════

describe("OrderInteractionService.createInteraction", () => {
  it("creates an interaction for a valid buyer", async () => {
    mockFindOrderForInteraction.mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "PAYMENT_HELD",
    });
    mockFindPendingByTypeAndOrder.mockResolvedValue(null);
    mockCreateInteraction.mockResolvedValue({ id: "int-1" });

    const result = await service.createInteraction(BASE_INPUT);
    expect(result.id).toBe("int-1");
    expect(mockCreateInteraction).toHaveBeenCalledOnce();
  });

  it("throws NOT_FOUND when order does not exist", async () => {
    mockFindOrderForInteraction.mockResolvedValue(null);

    await expect(service.createInteraction(BASE_INPUT)).rejects.toThrow(
      "not found",
    );
  });

  it("throws UNAUTHORISED when user is not a party to the order", async () => {
    mockFindOrderForInteraction.mockResolvedValue({
      id: "order-1",
      buyerId: "other-buyer",
      sellerId: "other-seller",
      status: "PAYMENT_HELD",
    });

    await expect(service.createInteraction(BASE_INPUT)).rejects.toThrow(
      "buyer or seller",
    );
  });

  it("throws ORDER_WRONG_STATE when duplicate pending interaction exists", async () => {
    mockFindOrderForInteraction.mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "PAYMENT_HELD",
    });
    mockFindPendingByTypeAndOrder.mockResolvedValue({ id: "existing-int" });

    await expect(service.createInteraction(BASE_INPUT)).rejects.toThrow(
      "already a pending request",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// respondToInteraction
// ═══════════════════════════════════════════════════════════════════════════

describe("OrderInteractionService.respondToInteraction", () => {
  const pendingInteraction = {
    id: "int-1",
    orderId: "order-1",
    status: INTERACTION_STATUSES.PENDING,
    initiatedById: "buyer-1",
    order: { buyerId: "buyer-1", sellerId: "seller-1" },
  };

  it("accepts an interaction and sets resolution to CANCELLED", async () => {
    mockFindByIdWithOrder.mockResolvedValue(pendingInteraction);
    mockUpdateInteraction.mockResolvedValue({});

    const result = await service.respondToInteraction(
      "int-1",
      "seller-1",
      "ACCEPT",
    );

    expect(result.action).toBe("ACCEPT");
    const updateCall = mockUpdateInteraction.mock.calls[0]!;
    expect(updateCall[1]).toMatchObject({
      status: "ACCEPTED",
      resolution: "CANCELLED",
    });
  });

  it("rejects an interaction without setting resolution", async () => {
    mockFindByIdWithOrder.mockResolvedValue(pendingInteraction);
    mockUpdateInteraction.mockResolvedValue({});

    const result = await service.respondToInteraction(
      "int-1",
      "seller-1",
      "REJECT",
      "Not eligible",
    );

    expect(result.action).toBe("REJECT");
    const updateCall = mockUpdateInteraction.mock.calls[0]!;
    expect(updateCall[1].status).toBe("REJECTED");
    expect(updateCall[1].responseNote).toBe("Not eligible");
    expect(updateCall[1]).not.toHaveProperty("resolution");
  });

  it("throws NOT_FOUND when interaction does not exist", async () => {
    mockFindByIdWithOrder.mockResolvedValue(null);
    await expect(
      service.respondToInteraction("nope", "seller-1", "ACCEPT"),
    ).rejects.toThrow("not found");
  });

  it("throws ORDER_WRONG_STATE when already responded", async () => {
    mockFindByIdWithOrder.mockResolvedValue({
      ...pendingInteraction,
      status: INTERACTION_STATUSES.ACCEPTED,
    });
    await expect(
      service.respondToInteraction("int-1", "seller-1", "ACCEPT"),
    ).rejects.toThrow("already been responded");
  });

  it("throws UNAUTHORISED when initiator tries to respond to own request", async () => {
    mockFindByIdWithOrder.mockResolvedValue(pendingInteraction);
    await expect(
      service.respondToInteraction("int-1", "buyer-1", "ACCEPT"),
    ).rejects.toThrow("other party");
  });

  it("throws UNAUTHORISED when non-party tries to respond", async () => {
    mockFindByIdWithOrder.mockResolvedValue(pendingInteraction);
    await expect(
      service.respondToInteraction("int-1", "stranger", "ACCEPT"),
    ).rejects.toThrow("other party");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Read-only helpers
// ═══════════════════════════════════════════════════════════════════════════

describe("OrderInteractionService.getActiveInteractions", () => {
  it("delegates to repository", async () => {
    mockFindActiveByOrder.mockResolvedValue([{ id: "int-1" }]);
    const result = await service.getActiveInteractions("order-1");
    expect(result).toEqual([{ id: "int-1" }]);
    expect(mockFindActiveByOrder).toHaveBeenCalledWith("order-1");
  });
});

describe("OrderInteractionService.getInteractionsByOrder", () => {
  it("delegates to repository", async () => {
    mockFindAllByOrder.mockResolvedValue([{ id: "int-1" }, { id: "int-2" }]);
    const result = await service.getInteractionsByOrder("order-1");
    expect(result).toHaveLength(2);
  });
});
