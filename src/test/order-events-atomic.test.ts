// src/test/order-events-atomic.test.ts
// ─── Fix 4: Order event writes are transactional ─────────────────────────────
// Verifies that event recording is inside the same DB transaction as the
// state change so that failures in either roll back atomically.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock order repository ─────────────────────────────────────────────────────

const mockTxFn = vi.fn();
const mockCreateEvent = vi.fn();

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findByIdForCancel: vi.fn(),
    findByIdForDelivery: vi.fn(),
    findSellerStripeAccount: vi.fn().mockResolvedValue(null),
    findByIdForEmail: vi.fn().mockResolvedValue(null),
    findListingTitle: vi.fn().mockResolvedValue(null),
    markPayoutsProcessing: vi.fn(),
    markListingSold: vi.fn(),
    reactivateListingInTx: vi.fn(),
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTxFn(fn),
    createEvent: (...args: unknown[]) => mockCreateEvent(...args),
  },
  DbClient: {},
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn(),
}));

vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    capturePayment: vi.fn(),
    refundPayment: vi.fn(),
  },
}));

vi.mock("@/lib/platform-config", () => ({
  getConfigInt: vi.fn().mockResolvedValue(60),
  CONFIG_KEYS: {
    FREE_CANCEL_WINDOW_MINUTES: "free_cancel",
    CANCEL_REQUEST_WINDOW_HOURS: "cancel_request",
  },
}));

vi.mock("@/modules/orders/order-event.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/modules/orders/order-event.service")
    >();
  return {
    ...actual,
    orderEventService: {
      recordEvent: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("@/lib/fire-and-forget", () => ({ fireAndForget: vi.fn() }));
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn(),
}));
vi.mock("@/server/email", () => ({
  sendCancellationEmail: vi.fn(),
  sendOrderDispatchedEmail: vi.fn(),
}));
vi.mock("@/lib/email-queue", () => ({ enqueueEmail: vi.fn() }));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { cancelOrder } from "@/modules/orders/order-cancel.service";
import { confirmDelivery } from "@/modules/orders/order-dispatch.service";
import { orderRepository } from "@/modules/orders/order.repository";
import { orderEventService } from "@/modules/orders/order-event.service";
import { paymentService } from "@/modules/payments/payment.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCancelOrder(overrides = {}) {
  return {
    id: "ord-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "PAYMENT_HELD",
    listingId: "listing-1",
    stripePaymentIntentId: null,
    createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
    ...overrides,
  };
}

function makeDeliveryOrder(overrides = {}) {
  return {
    id: "ord-2",
    buyerId: "buyer-2",
    sellerId: "seller-2",
    status: "DISPATCHED",
    listingId: "listing-2",
    stripePaymentIntentId: "pi_test",
    totalNzd: 5000,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("order state transitions — atomic event recording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: $transaction executes the callback with a mock tx object
    mockTxFn.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ _isMockTx: true }),
    );
  });

  it("cancelOrder: recordEvent is called inside the transaction callback", async () => {
    vi.mocked(orderRepository.findByIdForCancel).mockResolvedValue(
      makeCancelOrder() as never,
    );

    // Capture whether recordEvent was called while inside the tx callback
    let recordEventCalledInTx = false;
    mockTxFn.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = { _isMockTx: true };
        vi.mocked(orderEventService.recordEvent).mockImplementation((input) => {
          if ((input as { tx?: unknown }).tx === tx) {
            recordEventCalledInTx = true;
          }
          return Promise.resolve();
        });
        return fn(tx);
      },
    );

    await cancelOrder("ord-1", "buyer-1", "No longer needed");
    expect(recordEventCalledInTx).toBe(true);
  });

  it("cancelOrder: recordEvent receives the tx client", async () => {
    vi.mocked(orderRepository.findByIdForCancel).mockResolvedValue(
      makeCancelOrder() as never,
    );

    await cancelOrder("ord-1", "buyer-1");

    expect(vi.mocked(orderEventService.recordEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ tx: expect.anything() }),
    );
  });

  it("confirmDelivery: recordEvent is called with tx for COMPLETED event", async () => {
    vi.mocked(orderRepository.findByIdForDelivery).mockResolvedValue(
      makeDeliveryOrder() as never,
    );
    vi.mocked(paymentService.capturePayment).mockResolvedValue(undefined);

    let txPassedToEvent: unknown = undefined;
    mockTxFn.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = { _isMockTx: true };
        vi.mocked(orderEventService.recordEvent).mockImplementation((input) => {
          txPassedToEvent = (input as { tx?: unknown }).tx;
          return Promise.resolve();
        });
        return fn(tx);
      },
    );

    await confirmDelivery("ord-2", "buyer-2");
    expect(txPassedToEvent).toBeDefined();
    expect(txPassedToEvent).toMatchObject({ _isMockTx: true });
  });

  it("confirmDelivery: event write failure rolls back via the transaction", async () => {
    vi.mocked(orderRepository.findByIdForDelivery).mockResolvedValue(
      makeDeliveryOrder() as never,
    );
    vi.mocked(paymentService.capturePayment).mockResolvedValue(undefined);

    // Simulate the transaction propagating the event write failure
    mockTxFn.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        vi.mocked(orderEventService.recordEvent).mockRejectedValue(
          new Error("DB write failed"),
        );
        return fn({ _isMockTx: true });
      },
    );

    await expect(confirmDelivery("ord-2", "buyer-2")).rejects.toThrow(
      "DB write failed",
    );
  });
});
