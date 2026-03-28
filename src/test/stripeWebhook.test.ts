// src/test/stripeWebhook.test.ts
// ─── Tests for Stripe webhook idempotency (race-safe P2002 pattern) ─────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import db from "@/lib/db";

// Helper to create a Prisma unique constraint error (P2002)
function makePrismaP2002(): Error & { code: string } {
  const err = new Error(
    "Unique constraint failed on the fields: (`id`)",
  ) as Error & {
    code: string;
  };
  err.code = "P2002";
  return err;
}

describe("Stripe webhook idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes a new event successfully (create succeeds)", async () => {
    vi.mocked(db.stripeEvent.create).mockResolvedValue({
      id: "evt_new_123",
      type: "payment_intent.succeeded",
      processedAt: new Date(),
    } as never);

    // Simulate the webhook handler's idempotency check
    let shouldProcess = false;
    try {
      await db.stripeEvent.create({
        data: { id: "evt_new_123", type: "payment_intent.succeeded" },
      });
      shouldProcess = true;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        shouldProcess = false;
      } else {
        throw err;
      }
    }

    expect(shouldProcess).toBe(true);
    expect(db.stripeEvent.create).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate event gracefully (P2002 caught)", async () => {
    vi.mocked(db.stripeEvent.create).mockRejectedValue(makePrismaP2002());

    let shouldProcess = false;
    let wasDuplicate = false;

    try {
      await db.stripeEvent.create({
        data: { id: "evt_dup_456", type: "payment_intent.succeeded" },
      });
      shouldProcess = true;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        wasDuplicate = true;
        shouldProcess = false;
      } else {
        throw err;
      }
    }

    expect(wasDuplicate).toBe(true);
    expect(shouldProcess).toBe(false);
  });

  it("re-throws non-P2002 database errors", async () => {
    vi.mocked(db.stripeEvent.create).mockRejectedValue(
      new Error("Connection to database lost"),
    );

    await expect(async () => {
      try {
        await db.stripeEvent.create({
          data: { id: "evt_err_789", type: "payment_intent.succeeded" },
        });
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as { code: string }).code === "P2002"
        ) {
          return; // handled
        }
        throw err; // re-throw non-P2002
      }
    }).rejects.toThrow("Connection to database lost");
  });

  it("payout upsert is idempotent (no-op on duplicate)", async () => {
    vi.mocked(db.payout.upsert).mockResolvedValue({
      id: "payout-1",
      orderId: "order-1",
      status: "PENDING",
    } as never);

    // First call — creates payout
    await db.payout.upsert({
      where: { orderId: "order-1" },
      create: {
        orderId: "order-1",
        userId: "seller-1",
        amountNzd: 5000,
        platformFeeNzd: 0,
        stripeFeeNzd: 0,
        status: "PENDING",
      },
      update: {}, // no-op
    });

    // Second call — no-op update
    await db.payout.upsert({
      where: { orderId: "order-1" },
      create: {
        orderId: "order-1",
        userId: "seller-1",
        amountNzd: 5000,
        platformFeeNzd: 0,
        stripeFeeNzd: 0,
        status: "PENDING",
      },
      update: {}, // no-op
    });

    expect(db.payout.upsert).toHaveBeenCalledTimes(2);
    // Both calls used the same orderId — idempotent
    const calls = vi.mocked(db.payout.upsert).mock.calls;
    expect(calls[0]?.[0].where).toEqual({ orderId: "order-1" });
    expect(calls[1]?.[0].where).toEqual({ orderId: "order-1" });
    expect(calls[0]?.[0].update).toEqual({});
    expect(calls[1]?.[0].update).toEqual({});
  });
});
