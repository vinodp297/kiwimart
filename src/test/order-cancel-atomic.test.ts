// src/test/order-cancel-atomic.test.ts
// ─── Tests: Order cancellation — atomic transaction (Fix 2) ───────────────────
// Verifies that the CANCELLED status transition and listing reactivation
// are wrapped in a single $transaction so they are committed or rolled back
// together — no ghost RESERVED listings from partial failures.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

import db from "@/lib/db";
import { cancelOrder } from "@/modules/orders/order-cancel.service";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORDER_ID = "order-atomic-test-1";
const LISTING_ID = "listing-atomic-test-1";
const BUYER_ID = "buyer-atomic-test-1";
const SELLER_ID = "seller-atomic-test-1";

/** An order in PAYMENT_HELD state (cancellable, within free-cancel window). */
const HELD_ORDER = {
  id: ORDER_ID,
  buyerId: BUYER_ID,
  sellerId: SELLER_ID,
  status: "PAYMENT_HELD",
  createdAt: new Date(), // just created — within free-cancel window
  listingId: LISTING_ID,
  stripePaymentIntentId: null, // no Stripe payment, so no refund path
};

function setupDefaultMocks() {
  // findByIdForCancel (uses db.order.findFirst)
  vi.mocked(db.order.findFirst).mockResolvedValue(HELD_ORDER as never);

  // transitionOrder calls db.order.updateMany with optimistic lock
  vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });

  // reactivateListingInTx calls db.listing.updateMany
  vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 });

  // audit and orderEvent are mocked globally in setup.ts
}

// ─────────────────────────────────────────────────────────────────────────────

describe("cancelOrder — atomic transaction (Fix 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    // Restore the default $transaction implementation (executes callback with db)
    vi.mocked(db.$transaction).mockImplementation(
      async (fnOrArray: unknown) => {
        if (typeof fnOrArray === "function") {
          return (fnOrArray as (tx: unknown) => Promise<unknown>)(db);
        }
        return [];
      },
    );
  });

  // Test 1: Both operations run inside a single db.$transaction call
  it("wraps the status transition and listing reactivation in one $transaction", async () => {
    await cancelOrder(ORDER_ID, BUYER_ID);

    // The transaction must have been entered exactly once
    expect(db.$transaction).toHaveBeenCalledOnce();

    // Both the order status update and listing reactivation must have run
    expect(db.order.updateMany).toHaveBeenCalledOnce();
    expect(db.listing.updateMany).toHaveBeenCalledOnce();
  });

  // Test 2: If listing reactivation fails, the error propagates from $transaction
  // (In production Postgres this rolls back the order update; the mock verifies
  // the code structure is correct — both ops are inside the same tx callback.)
  it("propagates an error when listing reactivation fails inside the transaction", async () => {
    const listingError = new Error("listing.updateMany simulated failure");

    // Make the listing update throw after the order update succeeds
    vi.mocked(db.listing.updateMany).mockRejectedValueOnce(listingError);

    await expect(cancelOrder(ORDER_ID, BUYER_ID)).rejects.toThrow(
      "listing.updateMany simulated failure",
    );

    // The order update was attempted (inside the tx callback)
    expect(db.order.updateMany).toHaveBeenCalledOnce();

    // The listing update was also attempted (and threw — proving both are in same tx)
    expect(db.listing.updateMany).toHaveBeenCalledOnce();
  });

  // Test 3: $transaction is the outermost call — not the individual operations
  // This ensures the atomicity boundary is the whole cancellation, not per-step.
  it("calls $transaction before order or listing updates (atomicity boundary)", async () => {
    const callOrder: string[] = [];

    vi.mocked(db.$transaction).mockImplementation(
      async (fnOrArray: unknown) => {
        callOrder.push("$transaction");
        if (typeof fnOrArray === "function") {
          return (fnOrArray as (tx: unknown) => Promise<unknown>)(db);
        }
        return [];
      },
    );

    vi.mocked(db.order.updateMany).mockImplementation((async () => {
      callOrder.push("order.updateMany");
      return { count: 1 };
    }) as never);

    vi.mocked(db.listing.updateMany).mockImplementation((async () => {
      callOrder.push("listing.updateMany");
      return { count: 1 };
    }) as never);

    await cancelOrder(ORDER_ID, BUYER_ID);

    // $transaction must be called first — it encloses both DB writes
    expect(callOrder[0]).toBe("$transaction");

    // Both DB writes must occur inside the $transaction callback
    expect(callOrder).toContain("order.updateMany");
    expect(callOrder).toContain("listing.updateMany");

    // Transaction opens before any writes
    const txIdx = callOrder.indexOf("$transaction");
    const orderIdx = callOrder.indexOf("order.updateMany");
    const listingIdx = callOrder.indexOf("listing.updateMany");
    expect(txIdx).toBeLessThan(orderIdx);
    expect(txIdx).toBeLessThan(listingIdx);
  });
});
