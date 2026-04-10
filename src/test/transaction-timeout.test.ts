// src/test/transaction-timeout.test.ts
// ─── $transaction timeout option tests ───────────────────────────────────────
// Verifies that complex multi-table transactions set explicit timeout and
// maxWait options to prevent P2028 errors under DB load at p95.

import { describe, it, expect, beforeEach, vi } from "vitest";
import "../test/setup";

vi.mock("@/server/lib/requireUser", () => ({
  requireUser: vi
    .fn()
    .mockResolvedValue({ id: "user_buyer", email: "buyer@test.com" }),
}));

const { confirmDelivery } = await import("@/server/actions/orders");
const { default: db } = await import("@/lib/db");

// ── helpers ───────────────────────────────────────────────────────────────────

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order_1",
    buyerId: "user_buyer",
    sellerId: "user_seller",
    listingId: "listing_1",
    status: "DISPATCHED",
    stripePaymentIntentId: "pi_test_timeout",
    totalNzd: 5000,
    listing: { title: "Test Listing" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.$transaction).mockResolvedValue([]);
  vi.mocked(db.user.findUnique).mockResolvedValue(null as never);
});

// ── confirmDelivery transaction timeout ───────────────────────────────────────

describe("confirmDelivery — $transaction timeout option", () => {
  it("passes a timeout option to $transaction", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never);

    await confirmDelivery("order_1");

    expect(db.$transaction).toHaveBeenCalled();
    // $transaction is called as db.$transaction(fn, options) — options is arg[1]
    const calls = vi.mocked(db.$transaction).mock.calls;
    const optionsArg = calls[0]?.[1] as
      | { timeout?: number; maxWait?: number }
      | undefined;
    expect(optionsArg).toBeDefined();
    expect(optionsArg).toHaveProperty("timeout");
    expect(optionsArg).toHaveProperty("maxWait");
  });

  it("sets timeout to at least 10 000 ms", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never);

    await confirmDelivery("order_1");

    const calls = vi.mocked(db.$transaction).mock.calls;
    const optionsArg = calls[0]?.[1] as { timeout?: number } | undefined;
    expect(optionsArg?.timeout).toBeGreaterThanOrEqual(10_000);
  });

  it("sets maxWait to a positive value", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never);

    await confirmDelivery("order_1");

    const calls = vi.mocked(db.$transaction).mock.calls;
    const optionsArg = calls[0]?.[1] as { maxWait?: number } | undefined;
    expect(optionsArg?.maxWait).toBeGreaterThan(0);
  });
});
