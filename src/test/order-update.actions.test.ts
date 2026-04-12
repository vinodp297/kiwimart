// src/test/order-update.actions.test.ts
// ─── Tests: order-update.actions.ts (confirmDelivery, cancelOrder, markDispatched) ──
//
// This file covers the server-action thin layer over orderService.
// It validates:
//   A  Auth guard — requireUser throwing → action surfaces error
//   B  Schema validation — invalid input → { success: false } before service call
//   C  Happy paths — valid input → delegates to orderService, returns success
//   D  Service errors — orderService throwing → action surfaces error
//   E  markDispatched-specific → courier validation via getListValues

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
// Default: authenticated as buyer. Override per test where needed.
const mockRequireUser = vi.fn().mockResolvedValue({
  id: "user_buyer",
  email: "buyer@test.com",
  isAdmin: false,
  isSellerEnabled: false,
  isStripeOnboarded: false,
});
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock orderService ─────────────────────────────────────────────────────────
const mockConfirmDelivery = vi.fn().mockResolvedValue(undefined);
const mockCancelOrder = vi.fn().mockResolvedValue(undefined);
const mockMarkDispatched = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/orders/order.service", () => ({
  orderService: {
    confirmDelivery: (...args: unknown[]) => mockConfirmDelivery(...args),
    cancelOrder: (...args: unknown[]) => mockCancelOrder(...args),
    markDispatched: (...args: unknown[]) => mockMarkDispatched(...args),
  },
  OrderService: class {
    confirmDelivery = mockConfirmDelivery;
    cancelOrder = mockCancelOrder;
    markDispatched = mockMarkDispatched;
  },
}));

// ── Mock dynamic-lists for courier validation ─────────────────────────────────
const mockGetListValues = vi
  .fn()
  .mockResolvedValue(["NZ Post", "CourierPost", "DHL"]);
vi.mock("@/lib/dynamic-lists", () => ({
  getListValues: (...args: unknown[]) => mockGetListValues(...args),
}));

// ── Lazy import after mocks ───────────────────────────────────────────────────
const { confirmDelivery, cancelOrder, markDispatched } =
  await import("@/server/actions/order-update.actions");

// ── Helpers ───────────────────────────────────────────────────────────────────

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const VALID_DISPATCH_PARAMS = {
  orderId: "order_1",
  trackingNumber: "NZ123456789",
  courier: "NZ Post",
  estimatedDeliveryDate: tomorrow(),
  dispatchPhotos: ["photo_1.jpg"],
};

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A — Auth guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth guard — all three actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore list mock after clearAllMocks
    mockGetListValues.mockResolvedValue(["NZ Post", "CourierPost", "DHL"]);
  });

  it("confirmDelivery — unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await confirmDelivery("order_1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockConfirmDelivery).not.toHaveBeenCalled();
  });

  it("cancelOrder — unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await cancelOrder({ orderId: "order_1" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCancelOrder).not.toHaveBeenCalled();
  });

  it("markDispatched — unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await markDispatched(VALID_DISPATCH_PARAMS);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockMarkDispatched).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B — confirmDelivery
// ─────────────────────────────────────────────────────────────────────────────

describe("confirmDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
    mockConfirmDelivery.mockResolvedValue(undefined);
  });

  it("happy path — delegates to orderService.confirmDelivery with userId", async () => {
    const result = await confirmDelivery("order_1", { itemAsDescribed: true });

    expect(result.success).toBe(true);
    expect(mockConfirmDelivery).toHaveBeenCalledWith(
      "order_1",
      "user_buyer",
      expect.objectContaining({ itemAsDescribed: true }),
    );
  });

  it("happy path — works without optional feedback argument", async () => {
    const result = await confirmDelivery("order_1");

    expect(result.success).toBe(true);
    expect(mockConfirmDelivery).toHaveBeenCalledWith(
      "order_1",
      "user_buyer",
      expect.objectContaining({ itemAsDescribed: true }),
    );
  });

  it("schema validation — empty orderId returns error without calling service", async () => {
    const result = await confirmDelivery("", { itemAsDescribed: true });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockConfirmDelivery).not.toHaveBeenCalled();
  });

  it("service throws AppError — action surfaces human-readable error", async () => {
    mockConfirmDelivery.mockRejectedValueOnce(
      Object.assign(new Error("Order is not in a deliverable state."), {
        code: "ORDER_WRONG_STATE",
      }),
    );

    const result = await confirmDelivery("order_1", { itemAsDescribed: true });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("service throws generic error — action returns safe fallback message", async () => {
    mockConfirmDelivery.mockRejectedValueOnce(
      new Error("Database connection failed"),
    );

    const result = await confirmDelivery("order_1", { itemAsDescribed: true });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("feedback with issueType and notes is passed through to service", async () => {
    const result = await confirmDelivery("order_1", {
      itemAsDescribed: false,
      issueType: "WRONG_ITEM",
      notes: "Received wrong colour",
    });

    expect(result.success).toBe(true);
    expect(mockConfirmDelivery).toHaveBeenCalledWith(
      "order_1",
      "user_buyer",
      expect.objectContaining({
        itemAsDescribed: false,
        issueType: "WRONG_ITEM",
        notes: "Received wrong colour",
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C — cancelOrder
// ─────────────────────────────────────────────────────────────────────────────

describe("cancelOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
    mockCancelOrder.mockResolvedValue(undefined);
  });

  it("happy path — buyer cancels order", async () => {
    const result = await cancelOrder({ orderId: "order_1" });

    expect(result.success).toBe(true);
    expect(mockCancelOrder).toHaveBeenCalledWith(
      "order_1",
      "user_buyer",
      undefined,
    );
  });

  it("happy path — seller cancels with reason", async () => {
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
    });

    const result = await cancelOrder({
      orderId: "order_1",
      reason: "Out of stock",
    });

    expect(result.success).toBe(true);
    expect(mockCancelOrder).toHaveBeenCalledWith(
      "order_1",
      "user_seller",
      "Out of stock",
    );
  });

  it("schema validation — empty orderId returns error without calling service", async () => {
    const result = await cancelOrder({ orderId: "" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCancelOrder).not.toHaveBeenCalled();
  });

  it("order not found — service throws AppError.notFound → action surfaces error", async () => {
    mockCancelOrder.mockRejectedValueOnce(
      Object.assign(new Error("Order not found"), {
        code: "NOT_FOUND",
        statusCode: 404,
      }),
    );

    const result = await cancelOrder({ orderId: "order_missing" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("cancellation past window — service throws ORDER_WRONG_STATE → action surfaces error", async () => {
    mockCancelOrder.mockRejectedValueOnce(
      Object.assign(new Error("Cancellation window has closed."), {
        code: "ORDER_WRONG_STATE",
      }),
    );

    const result = await cancelOrder({ orderId: "order_dispatched" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP D — markDispatched
// ─────────────────────────────────────────────────────────────────────────────

describe("markDispatched", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
      isSellerEnabled: true,
    });
    mockMarkDispatched.mockResolvedValue(undefined);
    mockGetListValues.mockResolvedValue(["NZ Post", "CourierPost", "DHL"]);
  });

  it("happy path — seller marks dispatched with tracking details", async () => {
    const result = await markDispatched(VALID_DISPATCH_PARAMS);

    expect(result.success).toBe(true);
    expect(mockMarkDispatched).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_1",
        trackingNumber: "NZ123456789",
      }),
      "user_seller",
    );
  });

  it("tracking number is persisted — passed through to service", async () => {
    const result = await markDispatched({
      ...VALID_DISPATCH_PARAMS,
      trackingNumber: "TRACK-XYZ-999",
    });

    expect(result.success).toBe(true);
    expect(mockMarkDispatched).toHaveBeenCalledWith(
      expect.objectContaining({ trackingNumber: "TRACK-XYZ-999" }),
      "user_seller",
    );
  });

  it("invalid courier — not in getListValues list → returns error without calling service", async () => {
    const result = await markDispatched({
      ...VALID_DISPATCH_PARAMS,
      courier: "UnknownCourier",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/courier/i);
    expect(mockMarkDispatched).not.toHaveBeenCalled();
  });

  it("schema validation — missing trackingNumber → returns error without service call", async () => {
    const result = await markDispatched({
      ...VALID_DISPATCH_PARAMS,
      trackingNumber: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockMarkDispatched).not.toHaveBeenCalled();
  });

  it("schema validation — empty dispatchPhotos array → returns error", async () => {
    const result = await markDispatched({
      ...VALID_DISPATCH_PARAMS,
      dispatchPhotos: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockMarkDispatched).not.toHaveBeenCalled();
  });

  it("schema validation — empty orderId → returns error", async () => {
    const result = await markDispatched({
      ...VALID_DISPATCH_PARAMS,
      orderId: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockMarkDispatched).not.toHaveBeenCalled();
  });

  it("service throws — action surfaces safe error message", async () => {
    mockMarkDispatched.mockRejectedValueOnce(
      Object.assign(new Error("Order is not in a dispatchable state"), {
        code: "ORDER_WRONG_STATE",
      }),
    );

    const result = await markDispatched(VALID_DISPATCH_PARAMS);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("optional trackingUrl is passed through when provided", async () => {
    const result = await markDispatched({
      ...VALID_DISPATCH_PARAMS,
      trackingUrl: "https://track.nzpost.co.nz/NZ123",
    });

    expect(result.success).toBe(true);
    expect(mockMarkDispatched).toHaveBeenCalledWith(
      expect.objectContaining({
        trackingUrl: "https://track.nzpost.co.nz/NZ123",
      }),
      "user_seller",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP E — Cross-cutting error handling
// ─────────────────────────────────────────────────────────────────────────────

describe("Error handling — all actions return ActionResult on any throw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
    mockGetListValues.mockResolvedValue(["NZ Post"]);
  });

  it("confirmDelivery — never throws, always returns ActionResult", async () => {
    mockConfirmDelivery.mockRejectedValueOnce(new Error("Unexpected DB error"));

    const result = await confirmDelivery("order_1");

    expect(result).toHaveProperty("success", false);
    expect(() => result).not.toThrow();
  });

  it("cancelOrder — never throws, always returns ActionResult", async () => {
    mockCancelOrder.mockRejectedValueOnce(new Error("Connection reset"));

    const result = await cancelOrder({ orderId: "order_1" });

    expect(result).toHaveProperty("success", false);
    expect(() => result).not.toThrow();
  });

  it("markDispatched — never throws, always returns ActionResult", async () => {
    mockMarkDispatched.mockRejectedValueOnce(new Error("Timeout"));

    const result = await markDispatched(VALID_DISPATCH_PARAMS);

    expect(result).toHaveProperty("success", false);
    expect(() => result).not.toThrow();
  });
});
