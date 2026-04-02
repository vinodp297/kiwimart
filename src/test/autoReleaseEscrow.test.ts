// src/test/autoReleaseEscrow.test.ts
// ─── Tests for auto-release escrow: business day logic + null PI guard ───────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  addBusinessDays,
  processAutoReleases,
  getAutoReleaseCountdown,
} from "@/server/jobs/autoReleaseEscrow";
import db from "@/lib/db";
import { mockStripeCapture } from "./setup";

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-test",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    totalNzd: 5000,
    stripePaymentIntentId: "pi_test_123",
    dispatchedAt: new Date("2026-03-16T10:00:00Z"), // Monday
    listing: { id: "listing-1", title: "Test Item" },
    buyer: { email: "buyer@test.com", displayName: "Buyer" },
    seller: { email: "seller@test.com", displayName: "Seller" },
    ...overrides,
  };
}

describe("addBusinessDays", () => {
  it("Monday + 4 business days = Friday", () => {
    const monday = new Date("2026-03-16T10:00:00Z");
    const result = addBusinessDays(monday, 4);
    expect(result.getDay()).toBe(5); // Friday
    expect(result.getDate()).toBe(20); // March 20
  });

  it("Friday + 4 business days = Thursday (skips weekend)", () => {
    const friday = new Date("2026-03-20T10:00:00Z");
    const result = addBusinessDays(friday, 4);
    expect(result.getDay()).toBe(4); // Thursday
    expect(result.getDate()).toBe(26); // March 26
  });

  it("Wednesday + 4 business days = Tuesday", () => {
    const wednesday = new Date("2026-03-18T10:00:00Z");
    const result = addBusinessDays(wednesday, 4);
    expect(result.getDay()).toBe(2); // Tuesday
    expect(result.getDate()).toBe(24); // March 24
  });

  it("Thursday + 4 business days = Wednesday (skips 1 weekend)", () => {
    const thursday = new Date("2026-03-19T10:00:00Z");
    const result = addBusinessDays(thursday, 4);
    expect(result.getDay()).toBe(3); // Wednesday
    expect(result.getDate()).toBe(25); // March 25
  });

  it("+ 0 business days = same date", () => {
    const date = new Date("2026-03-16T10:00:00Z");
    const result = addBusinessDays(date, 0);
    expect(result.getDate()).toBe(16);
  });

  it("does not mutate the original date", () => {
    const original = new Date("2026-03-16T10:00:00Z");
    const originalTime = original.getTime();
    addBusinessDays(original, 4);
    expect(original.getTime()).toBe(originalTime);
  });
});

describe("processAutoReleases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases order dispatched exactly 4 business days ago (Mon→Fri)", async () => {
    vi.setSystemTime(new Date("2026-03-20T14:00:00Z")); // Friday 2pm

    vi.mocked(db.order.findMany).mockResolvedValue([makeOrder()] as never);
    vi.mocked(db.$transaction).mockResolvedValue([] as never);

    const result = await processAutoReleases();
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does NOT release Friday dispatch on Sunday (0 business days)", async () => {
    vi.setSystemTime(new Date("2026-03-22T10:00:00Z")); // Sunday

    const fridayOrder = makeOrder({
      id: "order-fri",
      dispatchedAt: new Date("2026-03-20T10:00:00Z"), // Friday
    });
    vi.mocked(db.order.findMany).mockResolvedValue([fridayOrder] as never);

    const result = await processAutoReleases();
    expect(result.processed).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("releases Friday dispatch on the following Thursday (4 biz days)", async () => {
    vi.setSystemTime(new Date("2026-03-26T10:00:00Z")); // Thursday

    const fridayOrder = makeOrder({
      id: "order-fri-release",
      dispatchedAt: new Date("2026-03-20T10:00:00Z"), // Friday
    });
    vi.mocked(db.order.findMany).mockResolvedValue([fridayOrder] as never);
    vi.mocked(db.$transaction).mockResolvedValue([] as never);

    const result = await processAutoReleases();
    expect(result.processed).toBe(1);
  });

  it("SKIPS order with null stripePaymentIntentId", async () => {
    vi.setSystemTime(new Date("2026-03-25T10:00:00Z"));

    const nullPiOrder = makeOrder({
      id: "order-no-pi",
      stripePaymentIntentId: null,
      dispatchedAt: new Date("2026-03-16T10:00:00Z"),
    });
    vi.mocked(db.order.findMany).mockResolvedValue([nullPiOrder] as never);

    const result = await processAutoReleases();
    expect(result.processed).toBe(0);
    expect(result.errors).toBe(1);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does NOT update DB if Stripe capture fails", async () => {
    vi.setSystemTime(new Date("2026-03-25T10:00:00Z"));

    // Make the shared mock capture function reject
    mockStripeCapture.mockRejectedValueOnce(new Error("Stripe network error"));

    const order = makeOrder({
      id: "order-stripe-fail",
      dispatchedAt: new Date("2026-03-16T10:00:00Z"),
    });
    vi.mocked(db.order.findMany).mockResolvedValue([order] as never);

    const result = await processAutoReleases();
    expect(result.errors).toBe(1);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("handles empty order list gracefully", async () => {
    vi.setSystemTime(new Date("2026-03-25T10:00:00Z"));
    vi.mocked(db.order.findMany).mockResolvedValue([] as never);

    const result = await processAutoReleases();
    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
  });
});

describe("getAutoReleaseCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns correct days remaining", async () => {
    vi.setSystemTime(new Date("2026-03-18T10:00:00Z")); // Wednesday
    const dispatchedAt = new Date("2026-03-16T10:00:00Z"); // Monday
    const countdown = await getAutoReleaseCountdown(dispatchedAt);
    // Release date is Friday March 20
    expect(countdown.daysRemaining).toBe(2);
  });

  it("returns 0 when past release date", async () => {
    vi.setSystemTime(new Date("2026-03-25T10:00:00Z"));
    const dispatchedAt = new Date("2026-03-16T10:00:00Z");
    const countdown = await getAutoReleaseCountdown(dispatchedAt);
    expect(countdown.daysRemaining).toBe(0);
  });
});
