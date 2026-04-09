// src/test/repository-methods.test.ts
// ─── Consolidated Repository Methods + getClient utility ──────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import db, { getClient } from "@/lib/db";
import { interactionRepository } from "@/modules/orders/interaction.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// getClient utility
// ═══════════════════════════════════════════════════════════════════════════

describe("getClient", () => {
  it("returns the default db when no transaction is provided", () => {
    const client = getClient();
    expect(client).toBe(db);
  });

  it("returns the default db when undefined is passed", () => {
    const client = getClient(undefined);
    expect(client).toBe(db);
  });

  it("returns the transaction client when provided", () => {
    const fakeTx = { order: { findUnique: vi.fn() } };
    const client = getClient(fakeTx as never);
    expect(client).toBe(fakeTx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// interactionRepository.findOrderForWorkflow
// ═══════════════════════════════════════════════════════════════════════════

describe("interactionRepository.findOrderForWorkflow", () => {
  it("returns order with superset select shape", async () => {
    const mockOrder = {
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "PAYMENT_HELD",
      createdAt: new Date(),
      stripePaymentIntentId: "pi_123",
      totalNzd: 5000,
      listing: { title: "Widget" },
    };
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockOrder,
    );

    const result = await interactionRepository.findOrderForWorkflow("order-1");

    expect(result).toEqual(mockOrder);
    expect(db.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1" },
        select: expect.objectContaining({
          id: true,
          buyerId: true,
          sellerId: true,
          status: true,
          stripePaymentIntentId: true,
          totalNzd: true,
        }),
      }),
    );
  });

  it("returns null when order does not exist", async () => {
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await interactionRepository.findOrderForWorkflow("missing");
    expect(result).toBeNull();
  });

  it("uses provided transaction client", async () => {
    const fakeTx = {
      order: { findUnique: vi.fn().mockResolvedValue({ id: "order-tx" }) },
    };

    const result = await interactionRepository.findOrderForWorkflow(
      "order-tx",
      fakeTx as never,
    );

    expect(result).toEqual({ id: "order-tx" });
    expect(fakeTx.order.findUnique).toHaveBeenCalledOnce();
    // Default db should NOT have been called
    expect(db.order.findUnique).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// interactionRepository.findOrderParties
// ═══════════════════════════════════════════════════════════════════════════

describe("interactionRepository.findOrderParties", () => {
  it("returns buyerId and sellerId", async () => {
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      buyerId: "buyer-1",
      sellerId: "seller-1",
    });

    const result = await interactionRepository.findOrderParties("order-1");
    expect(result).toEqual({ buyerId: "buyer-1", sellerId: "seller-1" });
  });

  it("returns null for missing order", async () => {
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await interactionRepository.findOrderParties("nope");
    expect(result).toBeNull();
  });
});
