// src/test/cancellation.test.ts
// ─── Tests for getCancellationStatus ─────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { getCancellationStatus } from "@/modules/orders/order.service";

describe("getCancellationStatus", () => {
  function makeOrder(
    overrides: Partial<{ status: string; createdAt: Date }> = {},
  ) {
    return {
      status: "PAYMENT_HELD",
      createdAt: new Date(),
      ...overrides,
    };
  }

  it("returns free window within first 60 minutes", async () => {
    const order = makeOrder({
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    }); // 30 min ago
    const status = await getCancellationStatus(order);

    expect(status.canCancel).toBe(true);
    expect(status.requiresReason).toBe(false);
    expect(status.windowType).toBe("free");
  });

  it("returns request window between 1-24 hours", async () => {
    const order = makeOrder({
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    }); // 3 hours ago
    const status = await getCancellationStatus(order);

    expect(status.canCancel).toBe(true);
    expect(status.requiresReason).toBe(true);
    expect(status.windowType).toBe("request");
  });

  it("returns closed after 24 hours", async () => {
    const order = makeOrder({
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    }); // 25 hours ago
    const status = await getCancellationStatus(order);

    expect(status.canCancel).toBe(false);
    expect(status.windowType).toBe("closed");
  });

  it("returns na for DISPATCHED orders", async () => {
    const order = makeOrder({ status: "DISPATCHED" });
    const status = await getCancellationStatus(order);

    expect(status.canCancel).toBe(false);
    expect(status.windowType).toBe("na");
    expect(status.message).toContain("dispatched");
  });

  it("returns na for COMPLETED orders", async () => {
    const order = makeOrder({ status: "COMPLETED" });
    const status = await getCancellationStatus(order);

    expect(status.canCancel).toBe(false);
    expect(status.windowType).toBe("na");
  });

  it("returns na for CANCELLED orders", async () => {
    const order = makeOrder({ status: "CANCELLED" });
    const status = await getCancellationStatus(order);

    expect(status.canCancel).toBe(false);
    expect(status.windowType).toBe("na");
  });

  it("returns free window at exactly 0 minutes", async () => {
    const order = makeOrder({ createdAt: new Date() });
    const status = await getCancellationStatus(order);

    expect(status.canCancel).toBe(true);
    expect(status.requiresReason).toBe(false);
    expect(status.windowType).toBe("free");
  });

  it("returns request window at exactly 61 minutes", async () => {
    const order = makeOrder({
      createdAt: new Date(Date.now() - 61 * 60 * 1000),
    });
    const status = await getCancellationStatus(order);

    expect(status.canCancel).toBe(true);
    expect(status.requiresReason).toBe(true);
    expect(status.windowType).toBe("request");
  });
});
