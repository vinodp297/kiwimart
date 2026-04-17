// src/test/order-shims.test.ts
// ─── Tests: re-export shim files for legacy import paths ────────────────────
// orderDetail.ts / orderEvents.ts / orders.ts are thin re-export shims that
// keep older import paths valid after the Task I5 split. A simple runtime
// import is enough to mark their (minimal) lines covered.

import { describe, it, expect } from "vitest";
import "./setup";

describe("order re-export shims", () => {
  it("orderDetail.ts re-exports fetchOrderDetail", async () => {
    const mod = await import("@/server/actions/orderDetail");
    expect(typeof mod.fetchOrderDetail).toBe("function");
  });

  it("orderEvents.ts re-exports getOrderTimeline", async () => {
    const mod = await import("@/server/actions/orderEvents");
    expect(typeof mod.getOrderTimeline).toBe("function");
  });

  it("orders.ts barrel re-exports all the split action functions", async () => {
    const mod = await import("@/server/actions/orders");
    expect(typeof mod.createOrder).toBe("function");
    expect(typeof mod.confirmDelivery).toBe("function");
    expect(typeof mod.cancelOrder).toBe("function");
    expect(typeof mod.markDispatched).toBe("function");
    expect(typeof mod.fetchOrderDetail).toBe("function");
    expect(typeof mod.getOrderTimeline).toBe("function");
    expect(typeof mod.uploadOrderEvidence).toBe("function");
  });
});
