// src/test/order-module-coverage.test.ts
// ─── Tests for order-cancel.service and order-dispatch.service ──────────────
// Covers cancellation status windows, cancelOrder guards, confirmDelivery
// guards, and markDispatched guards.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock order repository ────────────────────────────────────────────────────
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findByIdForCancel: vi.fn(),
    findByIdForDelivery: vi.fn(),
    findWithDisputeContext: vi.fn(),
    findByIdForEmail: vi.fn().mockResolvedValue(null),
    findSellerStripeAccount: vi.fn().mockResolvedValue(null),
    findListingTitle: vi.fn().mockResolvedValue(null),
    reactivateListingInTx: vi.fn().mockResolvedValue(undefined),
    markPayoutsProcessing: vi.fn().mockResolvedValue(undefined),
    markListingSold: vi.fn().mockResolvedValue(undefined),
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
  },
}));

// ── Mock order transitions ───────────────────────────────────────────────────
vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock payment service ─────────────────────────────────────────────────────
vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    refundPayment: vi.fn().mockResolvedValue(undefined),
    capturePayment: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock order-event service ─────────────────────────────────────────────────
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: {
    recordEvent: vi.fn().mockResolvedValue(undefined),
  },
  ORDER_EVENT_TYPES: {
    CANCELLED: "CANCELLED",
    DISPATCHED: "DISPATCHED",
    COMPLETED: "COMPLETED",
    DELIVERY_CONFIRMED_OK: "DELIVERY_CONFIRMED_OK",
    DELIVERY_ISSUE_REPORTED: "DELIVERY_ISSUE_REPORTED",
  },
  ACTOR_ROLES: {
    BUYER: "BUYER",
    SELLER: "SELLER",
  },
}));

// ── Mock order-interaction service ───────────────────────────────────────────
vi.mock("@/modules/orders/order-interaction.service", () => ({
  orderInteractionService: {
    createInteraction: vi.fn().mockResolvedValue(undefined),
  },
  INTERACTION_TYPES: { DELIVERY_ISSUE: "DELIVERY_ISSUE" },
  AUTO_ACTIONS: { AUTO_ESCALATE: "AUTO_ESCALATE" },
}));

// ── Mock notification service ────────────────────────────────────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock fire-and-forget ─────────────────────────────────────────────────────
vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: vi.fn(),
}));

// ── Mock email-queue ─────────────────────────────────────────────────────────
vi.mock("@/lib/email-queue", () => ({
  enqueueEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock request-context ─────────────────────────────────────────────────────
vi.mock("@/lib/request-context", () => ({
  getRequestContext: vi.fn().mockReturnValue({ correlationId: "corr-1" }),
}));

// ── Mock time constants ──────────────────────────────────────────────────────
vi.mock("@/lib/time", () => ({
  MS_PER_SECOND: 1_000,
  MS_PER_MINUTE: 60_000,
  MS_PER_HOUR: 3_600_000,
  MS_PER_DAY: 86_400_000,
  MS_PER_WEEK: 604_800_000,
  SECONDS_PER_MINUTE: 60,
  SECONDS_PER_HOUR: 3_600,
  SECONDS_PER_DAY: 86_400,
  SECONDS_PER_WEEK: 604_800,
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────
import {
  getCancellationStatus,
  cancelOrder,
} from "@/modules/orders/order-cancel.service";
import {
  confirmDelivery,
  markDispatched,
} from "@/modules/orders/order-dispatch.service";
import { AppError } from "@/shared/errors";
import { audit } from "@/server/lib/audit";
import { orderRepository } from "@/modules/orders/order.repository";
import { orderEventService } from "@/modules/orders/order-event.service";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal order stub for cancel tests */
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "PAYMENT_HELD",
    createdAt: new Date(),
    listingId: "listing-1",
    stripePaymentIntentId: "pi_test",
    totalNzd: 100,
    ...overrides,
  };
}

/** Build a minimal order stub for dispatch tests */
function makeDispatchOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "PAYMENT_HELD",
    listingId: "listing-1",
    stripePaymentIntentId: "pi_test",
    totalNzd: 100,
    buyer: { email: "buyer@test.com", displayName: "Buyer" },
    seller: { email: "seller@test.com", displayName: "Seller" },
    listing: { title: "Test Item" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply default $transaction implementation after clearAllMocks
  vi.mocked(orderRepository.$transaction).mockImplementation(
    async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)({}),
  );
});

// ─── getCancellationStatus ───────────────────────────────────────────────────

describe("getCancellationStatus", () => {
  it('returns "na" with DISPATCHED message for a DISPATCHED order', async () => {
    const result = await getCancellationStatus({
      status: "DISPATCHED",
      createdAt: new Date(),
    });

    expect(result.canCancel).toBe(false);
    expect(result.windowType).toBe("na");
    expect(result.message).toContain("dispatched");
  });

  it('returns "na" for other non-PAYMENT_HELD statuses', async () => {
    const result = await getCancellationStatus({
      status: "COMPLETED",
      createdAt: new Date(),
    });

    expect(result.canCancel).toBe(false);
    expect(result.windowType).toBe("na");
    expect(result.message).toContain("cannot be cancelled");
  });

  it('returns "free" within the free cancel window', async () => {
    const createdAt = new Date(Date.now() - 10 * 60 * 1000);

    const result = await getCancellationStatus({
      status: "PAYMENT_HELD",
      createdAt,
    });

    expect(result.canCancel).toBe(true);
    expect(result.requiresReason).toBe(false);
    expect(result.windowType).toBe("free");
    expect(result.message).toContain("Free cancellation");
  });

  it('returns "request" (requires reason) after free window but within request window', async () => {
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const result = await getCancellationStatus({
      status: "PAYMENT_HELD",
      createdAt,
    });

    expect(result.canCancel).toBe(true);
    expect(result.requiresReason).toBe(true);
    expect(result.windowType).toBe("request");
    expect(result.message).toContain("reason");
  });

  it('returns "closed" after the request window closes', async () => {
    const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const result = await getCancellationStatus({
      status: "PAYMENT_HELD",
      createdAt,
    });

    expect(result.canCancel).toBe(false);
    expect(result.windowType).toBe("closed");
    expect(result.message).toContain("closed");
  });
});

// ─── cancelOrder ─────────────────────────────────────────────────────────────

describe("cancelOrder", () => {
  it("throws AppError.notFound when order does not exist", async () => {
    vi.mocked(orderRepository.findByIdForCancel).mockResolvedValue(null);

    await expect(cancelOrder("order-1", "buyer-1")).rejects.toThrow(AppError);
  });

  it("throws when reason not provided in the request window", async () => {
    const order = makeOrder({
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    vi.mocked(orderRepository.findByIdForCancel).mockResolvedValue(
      order as never,
    );

    await expect(cancelOrder("order-1", "buyer-1")).rejects.toThrow(
      "Please provide a reason",
    );
  });

  it("records audit and event inside transaction on successful cancel", async () => {
    const order = makeOrder({
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    vi.mocked(orderRepository.findByIdForCancel).mockResolvedValue(
      order as never,
    );

    await cancelOrder("order-1", "buyer-1");

    expect(orderRepository.$transaction).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "buyer-1",
        action: "ORDER_STATUS_CHANGED",
        entityId: "order-1",
      }),
    );
    expect(orderEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        type: "CANCELLED",
      }),
    );
  });
});

// ─── confirmDelivery ─────────────────────────────────────────────────────────

describe("confirmDelivery", () => {
  it("throws AppError.notFound when order not found", async () => {
    vi.mocked(orderRepository.findByIdForDelivery).mockResolvedValue(null);

    await expect(confirmDelivery("order-1", "buyer-1")).rejects.toThrow(
      AppError,
    );
  });

  it("throws unauthorised when user is not the buyer", async () => {
    vi.mocked(orderRepository.findByIdForDelivery).mockResolvedValue(
      makeOrder({ status: "DISPATCHED" }) as never,
    );

    await expect(confirmDelivery("order-1", "wrong-user")).rejects.toThrow(
      "Only the buyer",
    );
  });

  it("throws ORDER_WRONG_STATE when order is not DISPATCHED or DELIVERED", async () => {
    vi.mocked(orderRepository.findByIdForDelivery).mockResolvedValue(
      makeOrder({ status: "PAYMENT_HELD" }) as never,
    );

    await expect(confirmDelivery("order-1", "buyer-1")).rejects.toThrow(
      "not in a deliverable state",
    );
  });

  it("throws missingPaymentIntent when no stripe PI", async () => {
    vi.mocked(orderRepository.findByIdForDelivery).mockResolvedValue(
      makeOrder({
        status: "DISPATCHED",
        stripePaymentIntentId: null,
      }) as never,
    );

    await expect(confirmDelivery("order-1", "buyer-1")).rejects.toThrow(
      AppError,
    );
  });
});

// ─── markDispatched ──────────────────────────────────────────────────────────

describe("markDispatched", () => {
  const dispatchInput = {
    orderId: "order-1",
    trackingNumber: "NZ123456",
    courier: "NZ Post",
    trackingUrl: "https://tracking.example.com/NZ123456",
    estimatedDeliveryDate: "2026-04-15",
    dispatchPhotos: ["photo1.jpg"],
  };

  it("throws AppError.notFound when order not found", async () => {
    vi.mocked(orderRepository.findWithDisputeContext).mockResolvedValue(null);

    await expect(markDispatched(dispatchInput, "seller-1")).rejects.toThrow(
      AppError,
    );
  });

  it("throws unauthorised when user is not the seller", async () => {
    vi.mocked(orderRepository.findWithDisputeContext).mockResolvedValue(
      makeDispatchOrder() as never,
    );

    await expect(markDispatched(dispatchInput, "wrong-user")).rejects.toThrow(
      "Only the seller",
    );
  });

  it("throws ORDER_WRONG_STATE when order is not PAYMENT_HELD", async () => {
    vi.mocked(orderRepository.findWithDisputeContext).mockResolvedValue(
      makeDispatchOrder({ status: "DISPATCHED" }) as never,
    );

    await expect(markDispatched(dispatchInput, "seller-1")).rejects.toThrow(
      "PAYMENT_HELD",
    );
  });
});
