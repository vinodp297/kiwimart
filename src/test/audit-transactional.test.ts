// src/test/audit-transactional.test.ts
// ─── Tests: transactional audit and recordEvent atomicity ────────────────────
// Verifies that audit() and orderEventService.recordEvent() write inside
// database transactions when a tx parameter is provided, and fire-and-forget
// when omitted (backward compatibility).

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Override the global audit mock so we test the REAL implementation ─────────
// The global setup.ts mocks audit as vi.fn(). We need the real module here.
vi.mock("@/server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/lib/audit")>();
  return { ...actual };
});

import "./setup";

import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate a minimal transaction client that tracks calls */
function makeTxSpy() {
  return {
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-tx-1" }),
    },
    orderEvent: {
      create: vi.fn().mockResolvedValue({ id: "evt-tx-1" }),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("audit() — transactional support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: audit(params) with no tx → fire-and-forget (returns void)
  it("without tx: returns void and writes via fire-and-forget", () => {
    const result = audit({
      userId: "user-1",
      action: "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: "order-1",
    });

    // No tx → returns void (not a Promise)
    expect(result).toBeUndefined();

    // DB write was called via the singleton db (fire-and-forget)
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  // Test 2: audit(params) with tx → returns Promise<void>
  it("with tx: returns a Promise that can be awaited", async () => {
    const txSpy = makeTxSpy();

    const result = audit({
      userId: "user-1",
      action: "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: "order-1",
      tx: txSpy as never,
    });

    // With tx → returns a Promise
    expect(result).toBeInstanceOf(Promise);
    await result;

    // Write went through the tx client, not the singleton
    expect(txSpy.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  // Test 3: audit with tx propagates errors (no silent catch)
  it("with tx: propagates write errors instead of catching them", async () => {
    const txSpy = makeTxSpy();
    txSpy.auditLog.create.mockRejectedValue(
      new Error("DB constraint violation"),
    );

    const promise = audit({
      userId: "user-1",
      action: "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: "order-1",
      tx: txSpy as never,
    });

    // With tx, errors propagate
    await expect(promise).rejects.toThrow("DB constraint violation");
  });

  // Test 4: audit without tx catches errors silently (backward compatible)
  it("without tx: catches write errors silently", async () => {
    vi.mocked(db.auditLog.create).mockRejectedValue(
      new Error("DB connection lost"),
    );

    // Should NOT throw — fire-and-forget catches the error
    const result = audit({
      userId: "user-1",
      action: "ORDER_STATUS_CHANGED",
      entityType: "Order",
      entityId: "order-1",
    });

    expect(result).toBeUndefined();

    // Give the .catch() time to execute
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("orderEventService.recordEvent() — transactional support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 5: recordEvent with no tx → returns Promise<void> (awaitable fire-and-forget)
  it("without tx: returns a Promise and writes via fire-and-forget", async () => {
    const result = orderEventService.recordEvent({
      orderId: "order-1",
      type: ORDER_EVENT_TYPES.COMPLETED,
      actorId: "user-1",
      actorRole: ACTOR_ROLES.BUYER,
      summary: "Test event",
    });

    // No tx → now returns a Promise<void> so callers can optionally await it
    expect(result).toBeInstanceOf(Promise);

    // Await the promise to ensure the DB write is triggered
    await result;

    // DB write was called via the singleton
    expect(db.orderEvent.create).toHaveBeenCalledTimes(1);
  });

  // Test 6: recordEvent with tx → returns Promise<void>
  it("with tx: returns a Promise that can be awaited", async () => {
    const txSpy = makeTxSpy();

    const result = orderEventService.recordEvent({
      orderId: "order-1",
      type: ORDER_EVENT_TYPES.COMPLETED,
      actorId: "user-1",
      actorRole: ACTOR_ROLES.BUYER,
      summary: "Test event",
      tx: txSpy as never,
    });

    expect(result).toBeInstanceOf(Promise);
    await result;

    // Write went through the tx client, not the singleton
    expect(txSpy.orderEvent.create).toHaveBeenCalledTimes(1);
    expect(db.orderEvent.create).not.toHaveBeenCalled();
  });

  // Test 7: recordEvent with tx propagates errors
  it("with tx: propagates write errors instead of catching them", async () => {
    const txSpy = makeTxSpy();
    txSpy.orderEvent.create.mockRejectedValue(new Error("FK violation"));

    const promise = orderEventService.recordEvent({
      orderId: "order-1",
      type: ORDER_EVENT_TYPES.COMPLETED,
      actorId: "user-1",
      actorRole: ACTOR_ROLES.BUYER,
      summary: "Test event",
      tx: txSpy as never,
    });

    await expect(promise).rejects.toThrow("FK violation");
  });
});

describe("cancelOrder — audit inside transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 8: cancelOrder calls audit inside $transaction callback
  it("audit write uses the transaction client passed by $transaction", async () => {
    const txAuditCalls: unknown[] = [];

    // Intercept $transaction to track what happens inside
    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
      // Create a tx-like object that tracks auditLog.create calls
      const txClient = {
        ...db,
        auditLog: {
          create: vi.fn().mockImplementation((args: unknown) => {
            txAuditCalls.push(args);
            return Promise.resolve({ id: "audit-in-tx" });
          }),
        },
      };
      return (fn as (tx: unknown) => Promise<unknown>)(txClient);
    });

    // Mock order lookup via the db mock (orderRepository.findByIdForCancel uses db)
    vi.mocked(db.order.findFirst).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "PAYMENT_HELD",
      createdAt: new Date(),
      listingId: "listing-1",
      stripePaymentIntentId: null,
    } as never);

    // Mock cancellation status — free window (very long so we're in free window)
    const { getConfigInt } = await import("@/lib/platform-config");
    vi.mocked(getConfigInt).mockResolvedValue(999);

    const { cancelOrder } =
      await import("@/modules/orders/order-cancel.service");
    await cancelOrder("order-1", "buyer-1");

    // The audit write should have gone through the tx client, not the global db
    expect(txAuditCalls.length).toBeGreaterThanOrEqual(1);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("confirmDelivery — audit inside transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 9: confirmDelivery calls audit inside $transaction callback
  it("audit write uses the transaction client passed by $transaction", async () => {
    const txAuditCalls: unknown[] = [];

    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
      const txClient = {
        ...db,
        auditLog: {
          create: vi.fn().mockImplementation((args: unknown) => {
            txAuditCalls.push(args);
            return Promise.resolve({ id: "audit-in-tx" });
          }),
        },
      };
      return (fn as (tx: unknown) => Promise<unknown>)(txClient);
    });

    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      status: "DISPATCHED",
      stripePaymentIntentId: "pi_test",
      totalNzd: 5000,
    } as never);

    vi.mocked(db.user.findUnique).mockResolvedValue({
      stripeAccountId: "acct_test",
    } as never);

    vi.mocked(db.listing.findUnique).mockResolvedValue({
      title: "Test Item",
    } as never);

    const { confirmDelivery } =
      await import("@/modules/orders/order-dispatch.service");
    await confirmDelivery("order-1", "buyer-1");

    // The audit write should have gone through the tx client
    expect(txAuditCalls.length).toBeGreaterThanOrEqual(1);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
