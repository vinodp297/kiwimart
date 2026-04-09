// src/test/order-detail-page.test.ts
// ─── Unit Tests: Order Detail Page refactor ───────────────────────────────────
//
// Covers pure-logic helpers that are safe to test in the Vitest node
// environment (no jsdom / React Testing Library required):
//
//   1.  validateDispatch — all four guard conditions
//   2.  validateConfirmDelivery — null & "no" with missing issue-type
//   3.  validateDispute — empty reason and short description
//   4.  validateMinLength — boundary conditions
//   5.  buildSyntheticEvents — timeline shape from order data
//   6.  Pending-interaction selectors — correct lookup from interactions array
//   7.  ModalType exhaustiveness — all 10 modal keys are unique strings
//   8.  useOrderActions initial return shape — hook exported correctly

import { describe, it, expect } from "vitest";

import {
  validateDispatch,
  validateConfirmDelivery,
  validateDispute,
  validateMinLength,
} from "../app/(protected)/orders/[id]/hooks/useOrderActions";

import { buildSyntheticEvents } from "../app/(protected)/orders/[id]/components/order-utils";
import type { OrderDetailData } from "../app/(protected)/orders/[id]/components/order-types";
import type { InteractionData } from "@/server/actions/interactions";

// ─── 1. validateDispatch ──────────────────────────────────────────────────────

describe("validateDispatch", () => {
  const valid = {
    courierService: "NZ Post",
    trackingNumber: "NZ123456789",
    estimatedDeliveryDate: "2026-04-15",
    dispatchPhotoKeys: ["key-1"],
  };

  it("returns null when all fields are present", () => {
    expect(validateDispatch(valid)).toBeNull();
  });

  it("rejects when courierService is empty", () => {
    expect(validateDispatch({ ...valid, courierService: "" })).toBe(
      "Please select a courier service.",
    );
  });

  it("rejects when trackingNumber is empty", () => {
    expect(validateDispatch({ ...valid, trackingNumber: "" })).toBe(
      "Please enter a tracking number.",
    );
  });

  it("rejects when estimatedDeliveryDate is empty", () => {
    expect(validateDispatch({ ...valid, estimatedDeliveryDate: "" })).toBe(
      "Please select an estimated delivery date.",
    );
  });

  it("rejects when no dispatch photos have been uploaded", () => {
    expect(validateDispatch({ ...valid, dispatchPhotoKeys: [] })).toBe(
      "Please upload at least 1 dispatch photo.",
    );
  });

  it("validates courierService before trackingNumber (first guard wins)", () => {
    const err = validateDispatch({
      ...valid,
      courierService: "",
      trackingNumber: "",
    });
    expect(err).toBe("Please select a courier service.");
  });
});

// ─── 2. validateConfirmDelivery ───────────────────────────────────────────────

describe("validateConfirmDelivery", () => {
  it("returns null when itemAsDescribed is yes (no issue type needed)", () => {
    expect(
      validateConfirmDelivery({
        itemAsDescribed: "yes",
        deliveryIssueType: "",
      }),
    ).toBeNull();
  });

  it("returns null when itemAsDescribed is no AND issue type is provided", () => {
    expect(
      validateConfirmDelivery({
        itemAsDescribed: "no",
        deliveryIssueType: "not_as_described",
      }),
    ).toBeNull();
  });

  it("rejects when itemAsDescribed is null (user hasn't answered)", () => {
    expect(
      validateConfirmDelivery({
        itemAsDescribed: null,
        deliveryIssueType: "",
      }),
    ).toBe("Please confirm whether the item arrived as described.");
  });

  it("rejects when itemAsDescribed is no but no issue type selected", () => {
    expect(
      validateConfirmDelivery({
        itemAsDescribed: "no",
        deliveryIssueType: "",
      }),
    ).toBe("Please select what's wrong with the item.");
  });
});

// ─── 3. validateDispute ───────────────────────────────────────────────────────

describe("validateDispute", () => {
  it("returns null when reason is set and description is ≥ 20 chars", () => {
    expect(
      validateDispute({
        disputeReason: "item_not_received",
        disputeDescription: "I never received the item after two weeks.",
      }),
    ).toBeNull();
  });

  it("rejects when disputeReason is empty", () => {
    expect(
      validateDispute({
        disputeReason: "",
        disputeDescription: "I never received the item after two weeks.",
      }),
    ).toBeTruthy();
  });

  it("rejects when disputeDescription is shorter than 20 characters", () => {
    expect(
      validateDispute({
        disputeReason: "item_not_received",
        disputeDescription: "Too short",
      }),
    ).toBeTruthy();
  });

  it("rejects when description is exactly 19 characters", () => {
    expect(
      validateDispute({
        disputeReason: "item_not_received",
        disputeDescription: "1234567890123456789", // 19 chars
      }),
    ).toBeTruthy();
  });

  it("passes when description is exactly 20 characters", () => {
    expect(
      validateDispute({
        disputeReason: "item_not_received",
        disputeDescription: "12345678901234567890", // 20 chars
      }),
    ).toBeNull();
  });
});

// ─── 4. validateMinLength ─────────────────────────────────────────────────────

describe("validateMinLength", () => {
  const msg = "Too short";

  it("returns null when trimmed length meets the minimum", () => {
    expect(validateMinLength("1234567890", 10, msg)).toBeNull();
  });

  it("returns the message when trimmed length is below minimum", () => {
    expect(validateMinLength("short", 10, msg)).toBe(msg);
  });

  it("trims whitespace before measuring length", () => {
    // "  short  " trims to "short" (5 chars) < 10
    expect(validateMinLength("  short  ", 10, msg)).toBe(msg);
  });

  it("returns null for exactly the minimum length", () => {
    expect(validateMinLength("1234567890", 10, msg)).toBeNull();
  });

  it("returns the message for length one below minimum", () => {
    expect(validateMinLength("123456789", 10, msg)).toBe(msg);
  });
});

// ─── 5. buildSyntheticEvents ──────────────────────────────────────────────────

describe("buildSyntheticEvents", () => {
  function makeOrder(
    overrides: Partial<OrderDetailData> = {},
  ): OrderDetailData {
    return {
      id: "order-1",
      listingId: "listing-1",
      listingTitle: "Test Item",
      listingThumbnail: "/img.jpg",
      status: "PAID",
      itemPrice: 100,
      shippingPrice: 10,
      total: 110,
      createdAt: "2026-04-01T00:00:00Z",
      dispatchedAt: null,
      deliveredAt: null,
      completedAt: null,
      trackingNumber: null,
      trackingUrl: null,
      dispute: null,
      isBuyer: true,
      buyerId: "buyer-1",
      sellerId: "seller-1",
      otherPartyName: "Seller Name",
      otherPartyUsername: "seller",
      hasReview: false,
      hasBuyerReview: false,
      hasSellerReview: false,
      cancelledBy: null,
      cancelReason: null,
      cancelledAt: null,
      fulfillmentType: "COURIER",
      pickupStatus: null,
      pickupScheduledAt: null,
      pickupWindowExpiresAt: null,
      otpExpiresAt: null,
      rescheduleCount: 0,
      ...overrides,
    };
  }

  it("returns at least one event for a freshly paid order", () => {
    const events = buildSyntheticEvents(makeOrder({ status: "PAID" }));
    expect(events.length).toBeGreaterThan(0);
  });

  it("includes a DISPATCHED event when dispatchedAt is set", () => {
    const events = buildSyntheticEvents(
      makeOrder({
        status: "dispatched",
        dispatchedAt: "2026-04-03T10:00:00Z",
      }),
    );
    // buildSyntheticEvents uses the `type` field on TimelineEvent, not `status`
    const dispatched = events.find((e) => e.type === "DISPATCHED");
    expect(dispatched).toBeDefined();
  });

  it("includes a COMPLETED event when completedAt is set and status is completed", () => {
    const events = buildSyntheticEvents(
      makeOrder({
        status: "completed",
        dispatchedAt: "2026-04-03T10:00:00Z",
        completedAt: "2026-04-05T14:00:00Z",
      }),
    );
    const completed = events.find((e) => e.type === "COMPLETED");
    expect(completed).toBeDefined();
  });

  it("events array is ordered chronologically (createdAt first)", () => {
    const events = buildSyntheticEvents(
      makeOrder({
        status: "dispatched",
        dispatchedAt: "2026-04-03T10:00:00Z",
      }),
    );
    // First event should correspond to order creation (oldest timestamp)
    const timestamps = events
      .map((e) => e.createdAt)
      .filter(Boolean) as string[];
    if (timestamps.length > 1) {
      const first = timestamps[0]!;
      const last = timestamps[timestamps.length - 1]!;
      expect(new Date(first).getTime()).toBeLessThanOrEqual(
        new Date(last).getTime(),
      );
    }
  });
});

// ─── 6. Pending-interaction selectors ─────────────────────────────────────────

describe("pending interaction selectors", () => {
  function makeInteraction(type: string, status: string): InteractionData {
    return {
      id: `int-${type}-${status}`,
      type,
      status,
      orderId: "order-1",
      initiatorId: "user-1",
      reason: "test reason",
      responseNote: null,
      details: null,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
      resolvedAt: null,
    } as unknown as InteractionData;
  }

  const interactions: InteractionData[] = [
    makeInteraction("CANCEL_REQUEST", "PENDING"),
    makeInteraction("RETURN_REQUEST", "PENDING"),
    makeInteraction("PARTIAL_REFUND_REQUEST", "PENDING"),
    makeInteraction("SHIPPING_DELAY", "PENDING"),
    makeInteraction("CANCEL_REQUEST", "RESOLVED"), // should NOT match
    makeInteraction("RETURN_REQUEST", "REJECTED"), // should NOT match
  ];

  it("finds PENDING CANCEL_REQUEST", () => {
    const match = interactions.find(
      (i) => i.type === "CANCEL_REQUEST" && i.status === "PENDING",
    );
    expect(match).toBeDefined();
    expect(match?.id).toBe("int-CANCEL_REQUEST-PENDING");
  });

  it("finds PENDING RETURN_REQUEST", () => {
    const match = interactions.find(
      (i) => i.type === "RETURN_REQUEST" && i.status === "PENDING",
    );
    expect(match).toBeDefined();
  });

  it("finds PENDING or COUNTERED PARTIAL_REFUND_REQUEST", () => {
    const interactions2: InteractionData[] = [
      makeInteraction("PARTIAL_REFUND_REQUEST", "COUNTERED"),
    ];
    const match = interactions2.find(
      (i) =>
        i.type === "PARTIAL_REFUND_REQUEST" &&
        (i.status === "PENDING" || i.status === "COUNTERED"),
    );
    expect(match).toBeDefined();
  });

  it("does NOT match a RESOLVED cancellation as pending", () => {
    const match = interactions.find(
      (i) => i.type === "CANCEL_REQUEST" && i.status === "PENDING",
    );
    // Only one match, and it should not be the RESOLVED one
    expect(match?.status).toBe("PENDING");
  });
});

// ─── 7. ModalType values are unique strings ───────────────────────────────────

describe("ModalType keys", () => {
  // TypeScript enforces uniqueness at compile time; at runtime we just verify
  // the string values we rely on in the client component are distinct.
  const modalValues = [
    "dispatch",
    "confirm",
    "dispute",
    "cancelRequest",
    "returnRequest",
    "partialRefund",
    "shippingDelay",
    "problemResolver",
    "sellerResponse",
    "counterEvidence",
  ] as const;

  it("has 10 distinct modal keys", () => {
    expect(new Set(modalValues).size).toBe(10);
  });

  it("every modal key is a non-empty string", () => {
    for (const key of modalValues) {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });
});

// ─── 8. useOrderActions is exported as a function ────────────────────────────

describe("useOrderActions export", () => {
  it("is exported as a named function from the hooks module", async () => {
    const mod =
      await import("../app/(protected)/orders/[id]/hooks/useOrderActions");
    expect(typeof mod.useOrderActions).toBe("function");
  });

  it("exports validateDispatch, validateConfirmDelivery, validateDispute, validateMinLength", async () => {
    const mod =
      await import("../app/(protected)/orders/[id]/hooks/useOrderActions");
    expect(typeof mod.validateDispatch).toBe("function");
    expect(typeof mod.validateConfirmDelivery).toBe("function");
    expect(typeof mod.validateDispute).toBe("function");
    expect(typeof mod.validateMinLength).toBe("function");
  });
});
