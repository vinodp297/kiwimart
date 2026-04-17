// src/test/pickup.actions.test.ts
// ─── Tests: pickup.actions.ts server actions ────────────────────────────────
// Covers initiatePickupOTP, confirmPickupOTP, rejectItemAtPickup

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn().mockResolvedValue({
  id: "user_seller",
  email: "seller@test.com",
  isAdmin: false,
});
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock queue (extend global with pickupQueue.remove) ────────────────────────
const mockPickupQueueAdd = vi.fn().mockResolvedValue({ id: "job_1" });
const mockPickupQueueRemove = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/queue", () => ({
  pickupQueue: {
    add: (...a: unknown[]) => mockPickupQueueAdd(...a),
    remove: (...a: unknown[]) => mockPickupQueueRemove(...a),
  },
  payoutQueue: { add: vi.fn() },
  emailQueue: { add: vi.fn() },
  getQueueConnection: vi.fn().mockReturnValue({}),
}));

// ── Mock orderRepository ──────────────────────────────────────────────────────
const mockFindForInitiateOTP = vi.fn();
const mockFindForConfirmOTP = vi.fn();
const mockFindForRejectAtPickup = vi.fn();
const mockOrderRepositoryTransaction = vi.fn();
const mockUpdateOtpJobId = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findForInitiateOTP: (...args: unknown[]) => mockFindForInitiateOTP(...args),
    findForConfirmOTP: (...args: unknown[]) => mockFindForConfirmOTP(...args),
    findForRejectAtPickup: (...args: unknown[]) =>
      mockFindForRejectAtPickup(...args),
    $transaction: (...args: unknown[]) =>
      mockOrderRepositoryTransaction(...args),
    updateOtpJobId: (...args: unknown[]) => mockUpdateOtpJobId(...args),
  },
}));

// ── Mock pickup-otp.service ───────────────────────────────────────────────────
const mockGenerateAndSendOTP = vi.fn().mockResolvedValue(undefined);
const mockVerifyOTP = vi.fn().mockResolvedValue({ valid: true });
vi.mock("@/server/services/pickup/pickup-otp.service", () => ({
  generateAndSendOTP: (...args: unknown[]) => mockGenerateAndSendOTP(...args),
  verifyOTP: (...args: unknown[]) => mockVerifyOTP(...args),
}));

// ── Mock orderEventService ────────────────────────────────────────────────────
const mockRecordEvent = vi.fn();
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: {
    recordEvent: (...args: unknown[]) => mockRecordEvent(...args),
  },
  ORDER_EVENT_TYPES: {
    ORDER_CREATED: "ORDER_CREATED",
    COMPLETED: "COMPLETED",
    DISPUTE_OPENED: "DISPUTE_OPENED",
  },
  ACTOR_ROLES: {
    SELLER: "SELLER",
    BUYER: "BUYER",
  },
}));

// ── Mock notification.service ─────────────────────────────────────────────────
const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

// ── Mock payment.service ──────────────────────────────────────────────────────
const mockCapturePayment = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    capturePayment: (...args: unknown[]) => mockCapturePayment(...args),
  },
}));

// ── Mock order.transitions ────────────────────────────────────────────────────
const mockTransitionOrder = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: (...args: unknown[]) => mockTransitionOrder(...args),
}));

// ── Mock dispute.service ──────────────────────────────────────────────────────
const mockCreateDispute = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/dispute/dispute.service", () => ({
  createDispute: (...args: unknown[]) => mockCreateDispute(...args),
}));

// ── Mock pickup-dispute-resolver.service ──────────────────────────────────────
const mockResolvePickupDispute = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/pickup/pickup-dispute-resolver.service", () => ({
  resolvePickupDispute: (...args: unknown[]) =>
    mockResolvePickupDispute(...args),
}));

// ── Mock fire-and-forget ──────────────────────────────────────────────────────
const mockFireAndForget = vi.fn();
vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: (...args: unknown[]) => mockFireAndForget(...args),
}));

// ── Mock currency ─────────────────────────────────────────────────────────────
const mockFormatCentsAsNzd = vi.fn().mockReturnValue("$50.00");
vi.mock("@/lib/currency", () => ({
  formatCentsAsNzd: (...args: unknown[]) => mockFormatCentsAsNzd(...args),
}));

// ── Mock request-context ──────────────────────────────────────────────────────
vi.mock("@/lib/request-context", () => ({
  getRequestContext: () => ({ correlationId: "test-corr" }),
}));

// ── Mock user.repository (extend global to add findEmailInfo) ─────────────────
const mockFindEmailInfo = vi.fn().mockResolvedValue({
  email: "seller@test.com",
  displayName: "Bob Seller",
});
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findEmailVerified: vi
      .fn()
      .mockResolvedValue({ emailVerified: new Date("2025-01-01") }),
    findEmailInfo: (...args: unknown[]) => mockFindEmailInfo(...args),
  },
}));

// ── Mock server email (extend global to include sendPayoutInitiatedEmail) ─────
vi.mock("@/server/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendDataExportEmail: vi.fn().mockResolvedValue(undefined),
  sendErasureConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendErasureRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendAdminIdVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendDisputeOpenedEmail: vi.fn().mockResolvedValue(undefined),
  sendPayoutInitiatedEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Lazy import after all mocks ───────────────────────────────────────────────
const { initiatePickupOTP, confirmPickupOTP, rejectItemAtPickup } =
  await import("@/server/actions/pickup.actions");

// ── Fixtures ──────────────────────────────────────────────────────────────────

// For initiatePickupOTP — pickupScheduledAt 5 min ago so now > earliestInitiation
// Setup mocks getConfigInt to return 10, so earliestInitiation = scheduledAt - 10min
// With scheduledAt 5min ago: earliestInitiation is 15min ago, window still open
const mockOrderForOTP = {
  id: "order_1",
  sellerId: "user_seller",
  buyerId: "user_buyer",
  fulfillmentType: "ONLINE_PAYMENT_PICKUP",
  pickupStatus: "SCHEDULED",
  pickupScheduledAt: new Date(Date.now() - 5 * 60 * 1000),
  pickupWindowExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  buyer: { phone: "+6421123456", displayName: "Alice" },
  listing: { title: "Test Item" },
  otpJobId: null,
};

// For confirmPickupOTP
const mockOrderForConfirm = {
  id: "order_1",
  sellerId: "user_seller",
  buyerId: "user_buyer",
  fulfillmentType: "ONLINE_PAYMENT_PICKUP",
  pickupStatus: "OTP_INITIATED",
  stripePaymentIntentId: "pi_test_123",
  totalNzd: 5000,
  listingId: "listing_1",
  listing: { title: "Test Item" },
  otpJobId: "otp-expired-order_1",
  pickupWindowJobId: "window-job-1",
};

// For rejectItemAtPickup
const mockOrderForReject = {
  id: "order_1",
  sellerId: "user_seller",
  buyerId: "user_buyer",
  fulfillmentType: "ONLINE_PAYMENT_PICKUP",
  status: "AWAITING_PICKUP",
  pickupStatus: "OTP_INITIATED",
  otpJobId: "otp-job-1",
};

// ─────────────────────────────────────────────────────────────────────────────
// initiatePickupOTP
// ─────────────────────────────────────────────────────────────────────────────

describe("initiatePickupOTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
      isAdmin: false,
    });
    mockFindForInitiateOTP.mockResolvedValue(mockOrderForOTP);
    mockGenerateAndSendOTP.mockResolvedValue(undefined);
    mockPickupQueueAdd.mockResolvedValue({ id: "job_1" });
    mockUpdateOtpJobId.mockResolvedValue(undefined);
    // Default transaction: execute callback with stub tx
    mockOrderRepositoryTransaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn({}),
    );
  });

  it("unauthenticated → auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await initiatePickupOTP("order_1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("order not found → error", async () => {
    mockFindForInitiateOTP.mockResolvedValueOnce(null);

    const result = await initiatePickupOTP("order_1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/order not found/i);
  });

  it("not the seller (order.sellerId !== user.id) → error", async () => {
    mockRequireUser.mockResolvedValueOnce({
      id: "different_user",
      email: "other@test.com",
    });

    const result = await initiatePickupOTP("order_1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/only the seller/i);
  });

  it("wrong fulfillmentType → error", async () => {
    mockFindForInitiateOTP.mockResolvedValueOnce({
      ...mockOrderForOTP,
      fulfillmentType: "SHIPPING",
    });

    const result = await initiatePickupOTP("order_1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/online-payment pickup/i);
  });

  it("wrong pickupStatus → error", async () => {
    mockFindForInitiateOTP.mockResolvedValueOnce({
      ...mockOrderForOTP,
      pickupStatus: "OTP_INITIATED",
    });

    const result = await initiatePickupOTP("order_1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/SCHEDULED/);
  });

  it("no pickupScheduledAt → error", async () => {
    mockFindForInitiateOTP.mockResolvedValueOnce({
      ...mockOrderForOTP,
      pickupScheduledAt: null,
    });

    const result = await initiatePickupOTP("order_1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/no pickup time/i);
  });

  it("no buyer phone → error", async () => {
    mockFindForInitiateOTP.mockResolvedValueOnce({
      ...mockOrderForOTP,
      buyer: { phone: null, displayName: "Alice" },
    });

    const result = await initiatePickupOTP("order_1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/phone number/i);
  });

  it("happy path → calls generateAndSendOTP, recordEvent, schedules job", async () => {
    const result = await initiatePickupOTP("order_1");

    expect(result.success).toBe(true);
    expect(mockGenerateAndSendOTP).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_1",
        buyerPhone: "+6421123456",
      }),
    );
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order_1" }),
    );
    expect(mockPickupQueueAdd).toHaveBeenCalled();
  });

  it("generateAndSendOTP throws → returns safeActionError", async () => {
    mockOrderRepositoryTransaction.mockImplementationOnce(
      async (fn: (tx: unknown) => unknown) => {
        mockGenerateAndSendOTP.mockRejectedValueOnce(
          new Error("SMS service unavailable"),
        );
        return fn({});
      },
    );

    const result = await initiatePickupOTP("order_1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// confirmPickupOTP
// ─────────────────────────────────────────────────────────────────────────────

describe("confirmPickupOTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
      isAdmin: false,
    });
    mockFindForConfirmOTP.mockResolvedValue(mockOrderForConfirm);
    mockVerifyOTP.mockResolvedValue({ valid: true });
    mockCapturePayment.mockResolvedValue(undefined);
    mockTransitionOrder.mockResolvedValue(undefined);
    // Transaction mock executes callback with a stub tx that has payout.upsert and listing.update
    mockOrderRepositoryTransaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          payout: { upsert: vi.fn().mockResolvedValue({}) },
          listing: { update: vi.fn().mockResolvedValue({}) },
          order: { update: vi.fn().mockResolvedValue({}) },
        }),
    );
  });

  it("unauthenticated → auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await confirmPickupOTP("order_1", "123456");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("order not found → error", async () => {
    mockFindForConfirmOTP.mockResolvedValueOnce(null);

    const result = await confirmPickupOTP("order_1", "123456");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/order not found/i);
  });

  it("not the buyer → error", async () => {
    mockRequireUser.mockResolvedValueOnce({
      id: "user_seller",
      email: "seller@test.com",
    });

    const result = await confirmPickupOTP("order_1", "123456");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/only the buyer/i);
  });

  it("OTP verification fails → error with specific message", async () => {
    mockOrderRepositoryTransaction.mockImplementationOnce(
      async (fn: (tx: unknown) => unknown) => {
        mockVerifyOTP.mockResolvedValueOnce({
          valid: false,
          error: "Incorrect code",
        });
        return fn({
          payout: { upsert: vi.fn().mockResolvedValue({}) },
          listing: { update: vi.fn().mockResolvedValue({}) },
          order: { update: vi.fn().mockResolvedValue({}) },
        });
      },
    );

    const result = await confirmPickupOTP("order_1", "000000");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/incorrect code/i);
  });

  it("happy path → calls verifyOTP + capturePayment + transitionOrder, returns success", async () => {
    const result = await confirmPickupOTP("order_1", "123456");

    expect(result.success).toBe(true);
    expect(mockVerifyOTP).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order_1", enteredCode: "123456" }),
    );
    expect(mockCapturePayment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: "pi_test_123" }),
    );
    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "order_1",
      "COMPLETED",
      expect.any(Object),
      expect.any(Object),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rejectItemAtPickup
// ─────────────────────────────────────────────────────────────────────────────

describe("rejectItemAtPickup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
      isAdmin: false,
    });
    mockFindForRejectAtPickup.mockResolvedValue(mockOrderForReject);
    mockCreateDispute.mockResolvedValue(undefined);
    mockResolvePickupDispute.mockResolvedValue(undefined);
    mockOrderRepositoryTransaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          order: { update: vi.fn().mockResolvedValue({}) },
        }),
    );
  });

  it("unauthenticated → auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await rejectItemAtPickup("order_1", {
      reason: "ITEM_NOT_AS_DESCRIBED",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("order not found → error", async () => {
    mockFindForRejectAtPickup.mockResolvedValueOnce(null);

    const result = await rejectItemAtPickup("order_1", {
      reason: "ITEM_DAMAGED",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/order not found/i);
  });

  it("not the buyer → error", async () => {
    mockRequireUser.mockResolvedValueOnce({
      id: "user_seller",
      email: "seller@test.com",
    });

    const result = await rejectItemAtPickup("order_1", {
      reason: "ITEM_DAMAGED",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/only the buyer/i);
  });

  it("wrong pickupStatus → error", async () => {
    mockFindForRejectAtPickup.mockResolvedValueOnce({
      ...mockOrderForReject,
      pickupStatus: "SCHEDULED",
    });

    const result = await rejectItemAtPickup("order_1", {
      reason: "ITEM_DAMAGED",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/can only be rejected/i);
  });

  it("reason is 'OTHER' with no reasonNote → error 'Please provide a genuine reason'", async () => {
    const result = await rejectItemAtPickup("order_1", {
      reason: "OTHER",
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toMatch(/please provide a genuine reason/i);
  });

  it("reason is 'OTHER' with reasonNote < 20 chars → error", async () => {
    const result = await rejectItemAtPickup("order_1", {
      reason: "OTHER",
      reasonNote: "Too short",
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toMatch(/please provide a genuine reason/i);
  });

  it("happy path ITEM_NOT_AS_DESCRIBED → success, calls createDispute", async () => {
    const result = await rejectItemAtPickup("order_1", {
      reason: "ITEM_NOT_AS_DESCRIBED",
      reasonNote: "The item colour was completely different from the listing.",
    });

    expect(result.success).toBe(true);
    expect(mockCreateDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_1",
        reason: "ITEM_NOT_AS_DESCRIBED",
        source: "PICKUP_REJECTION",
        buyerId: "user_buyer",
      }),
    );
  });

  it("resolvePickupDispute is called after reject", async () => {
    await rejectItemAtPickup("order_1", {
      reason: "ITEM_NOT_AS_DESCRIBED",
    });

    // Allow promise chains to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(mockResolvePickupDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_1",
        reason: "ITEM_NOT_AS_DESCRIBED",
      }),
    );
  });

  it("happy path with evidenceKeys → passed through to createDispute", async () => {
    const result = await rejectItemAtPickup("order_1", {
      reason: "ITEM_DAMAGED",
      evidenceKeys: ["disputes/user_buyer/photo1.jpg"],
    });

    expect(result.success).toBe(true);
    expect(mockCreateDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceKeys: ["disputes/user_buyer/photo1.jpg"],
      }),
    );
  });

  it("routes AWAITING_PICKUP → DISPUTED through transitionOrder (not a raw update)", async () => {
    // Capture the tx client handed to the transaction callback so we can prove
    // no direct tx.order.update() was used to flip status.
    const txOrderUpdate = vi.fn().mockResolvedValue({});
    mockOrderRepositoryTransaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({ order: { update: txOrderUpdate } }),
    );

    await rejectItemAtPickup("order_1", {
      reason: "ITEM_DAMAGED",
    });

    // The state flip must go through the state machine, carrying the pickup
    // fields + OTP cleanup in the transition payload.
    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "order_1",
      "DISPUTED",
      expect.objectContaining({
        pickupStatus: "REJECTED_AT_PICKUP",
        pickupRejectedAt: expect.any(Date),
        otpCodeHash: null,
        otpExpiresAt: null,
      }),
      expect.objectContaining({
        fromStatus: "AWAITING_PICKUP",
        tx: expect.anything(),
      }),
    );

    // And the bypass path must not be used.
    expect(txOrderUpdate).not.toHaveBeenCalled();
  });
});
