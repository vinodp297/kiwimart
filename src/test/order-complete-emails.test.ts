// src/test/order-complete-emails.test.ts
// ─── Order completion emails — buyer + seller ─────────────────────────────────
// Two separate describe blocks with different mock strategies:
//
//  A) Email function content tests — unmock @/server/email, mock transport
//     to capture the HTML/subject that would be sent to Resend.
//
//  B) confirmDelivery integration tests — rely on the global setup.ts mock of
//     enqueueEmail and verify it was called with the right template/params.
//
// Covers:
//   1. orderCompleteBuyer template sends with correct subject
//   2. orderCompleteSeller template sends with correct subject
//   3. confirmDelivery enqueues buyer email after order completion
//   4. confirmDelivery enqueues seller email after order completion
//   5. Buyer email contains order ID and listing title
//   6. Seller email contains payout timeline
//   7. Emails are queued via enqueueEmail, not sent inline
//   8. Email queue failure does NOT block order completion

import { describe, it, expect, vi, beforeEach } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════
// PART A — Email function HTML content tests
// Must unmock @/server/email so we test the REAL functions.
// ═══════════════════════════════════════════════════════════════════════════

// Capture what the transport would send to Resend
const mockTransportSend = vi.fn();

vi.unmock("@/server/email");

vi.mock("@/infrastructure/email/client", () => ({
  getEmailClient: () => ({
    emails: { send: (...a: unknown[]) => mockTransportSend(...a) },
  }),
}));

import {
  sendOrderCompleteBuyerEmail,
  sendOrderCompleteSellerEmail,
} from "@/server/email";

describe("sendOrderCompleteBuyerEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransportSend.mockResolvedValue({
      data: { id: "email-1" },
      error: null,
    });
    process.env.RESEND_API_KEY = "re_test_key";
  });

  it("sends with correct subject containing listing title", async () => {
    await sendOrderCompleteBuyerEmail({
      to: "buyer@test.nz",
      buyerName: "Frank",
      sellerName: "Grace",
      listingTitle: "Vintage Camera",
      orderId: "order-1",
      totalNzd: 12000,
      orderUrl: "https://buyzi.co.nz/orders/order-1",
    });

    expect(mockTransportSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Your order is complete — Vintage Camera",
      }),
    );
  });

  it("email body contains order ID and listing title", async () => {
    await sendOrderCompleteBuyerEmail({
      to: "buyer@test.nz",
      buyerName: "Frank",
      sellerName: "Grace",
      listingTitle: "Vintage Camera",
      orderId: "order-abc-123",
      totalNzd: 12000,
      orderUrl: "https://buyzi.co.nz/orders/order-abc-123",
    });

    const html = (mockTransportSend.mock.calls[0]![0] as { html: string }).html;
    expect(html).toContain("order-abc-123");
    expect(html).toContain("Vintage Camera");
  });

  it("formats total NZD correctly as dollar amount", async () => {
    await sendOrderCompleteBuyerEmail({
      to: "buyer@test.nz",
      buyerName: "Frank",
      sellerName: "Grace",
      listingTitle: "Widget",
      orderId: "order-1",
      totalNzd: 5050,
      orderUrl: "https://buyzi.co.nz/orders/order-1",
    });

    const html = (mockTransportSend.mock.calls[0]![0] as { html: string }).html;
    expect(html).toContain("$50.50 NZD");
  });
});

describe("sendOrderCompleteSellerEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransportSend.mockResolvedValue({
      data: { id: "email-2" },
      error: null,
    });
    process.env.RESEND_API_KEY = "re_test_key";
  });

  it("sends with correct subject", async () => {
    await sendOrderCompleteSellerEmail({
      to: "seller@test.nz",
      sellerName: "Grace",
      buyerFirstName: "Frank",
      listingTitle: "Vintage Camera",
      orderId: "order-1",
      totalNzd: 12000,
      payoutTimelineDays: 3,
      dashboardUrl: "https://buyzi.co.nz/dashboard/seller",
    });

    expect(mockTransportSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Order complete — payment released",
      }),
    );
  });

  it("email body contains payout timeline", async () => {
    await sendOrderCompleteSellerEmail({
      to: "seller@test.nz",
      sellerName: "Grace",
      buyerFirstName: "Frank",
      listingTitle: "Widget",
      orderId: "order-1",
      totalNzd: 8800,
      payoutTimelineDays: 3,
      dashboardUrl: "https://buyzi.co.nz/dashboard/seller",
    });

    const html = (mockTransportSend.mock.calls[0]![0] as { html: string }).html;
    expect(html).toContain("3 business days");
  });

  it("email body contains listing title and order ID", async () => {
    await sendOrderCompleteSellerEmail({
      to: "seller@test.nz",
      sellerName: "Grace",
      buyerFirstName: "Frank",
      listingTitle: "Vintage Camera",
      orderId: "order-xyz",
      totalNzd: 12000,
      payoutTimelineDays: 3,
      dashboardUrl: "https://buyzi.co.nz/dashboard/seller",
    });

    const html = (mockTransportSend.mock.calls[0]![0] as { html: string }).html;
    expect(html).toContain("Vintage Camera");
    expect(html).toContain("order-xyz");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART B — confirmDelivery integration: enqueueEmail called correctly
// Uses the global enqueueEmail mock from setup.ts — no need to override.
// ═══════════════════════════════════════════════════════════════════════════

const {
  mockTransitionOrder,
  mockCapturePayment,
  mockMarkPayoutsProcessing,
  mockMarkListingSold,
  mockFindByIdForDelivery,
  mockFindPartiesForCompletionEmail,
  mockOrderRepositoryTransaction,
} = vi.hoisted(() => ({
  mockTransitionOrder: vi.fn().mockResolvedValue(undefined),
  mockCapturePayment: vi.fn().mockResolvedValue(undefined),
  mockMarkPayoutsProcessing: vi.fn().mockResolvedValue(undefined),
  mockMarkListingSold: vi.fn().mockResolvedValue(undefined),
  mockFindByIdForDelivery: vi.fn(),
  mockFindPartiesForCompletionEmail: vi.fn(),
  mockOrderRepositoryTransaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: (...a: unknown[]) => mockTransitionOrder(...a),
}));

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    capturePayment: (...a: unknown[]) => mockCapturePayment(...a),
  },
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    COMPLETED: "COMPLETED",
    DELIVERY_CONFIRMED_OK: "DELIVERY_CONFIRMED_OK",
    DELIVERY_ISSUE_REPORTED: "DELIVERY_ISSUE_REPORTED",
  },
  ACTOR_ROLES: { BUYER: "BUYER", SELLER: "SELLER" },
}));

vi.mock("@/modules/orders/order-interaction.service", () => ({
  orderInteractionService: { createInteraction: vi.fn() },
  INTERACTION_TYPES: { DELIVERY_ISSUE: "DELIVERY_ISSUE" },
  AUTO_ACTIONS: { AUTO_ESCALATE: "AUTO_ESCALATE" },
}));

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findByIdForDelivery: (...a: unknown[]) => mockFindByIdForDelivery(...a),
    findPartiesForCompletionEmail: (...a: unknown[]) =>
      mockFindPartiesForCompletionEmail(...a),
    findSellerStripeAccount: vi.fn().mockResolvedValue(null),
    findListingTitle: vi.fn().mockResolvedValue({ title: "Vintage Camera" }),
    markPayoutsProcessing: (...a: unknown[]) => mockMarkPayoutsProcessing(...a),
    markListingSold: (...a: unknown[]) => mockMarkListingSold(...a),
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      mockOrderRepositoryTransaction(fn),
  },
}));

vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/queue", () => ({
  emailQueue: { add: vi.fn() },
  payoutQueue: { add: vi.fn().mockResolvedValue({}) },
  getQueueConnection: vi.fn().mockReturnValue({}),
}));

import { confirmDelivery } from "@/modules/orders/order-dispatch.service";
import { enqueueEmail } from "@/lib/email-queue";

const ORDER = {
  id: "order-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  listingId: "listing-1",
  status: "DISPATCHED" as const,
  stripePaymentIntentId: "pi_123",
  totalNzd: 12000,
};

const PARTIES = {
  totalNzd: 12000,
  buyer: { email: "buyer@test.nz", displayName: "Frank Brown" },
  seller: { email: "seller@test.nz", displayName: "Grace Lee" },
  listing: { title: "Vintage Camera" },
};

describe("confirmDelivery — email enqueuing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByIdForDelivery.mockResolvedValue(ORDER);
    mockFindPartiesForCompletionEmail.mockResolvedValue(PARTIES);
    mockOrderRepositoryTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  it("enqueues orderCompleteBuyer email after order completion", async () => {
    await confirmDelivery("order-1", "buyer-1");

    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ template: "orderCompleteBuyer" }),
    );
  });

  it("enqueues orderCompleteSeller email after order completion", async () => {
    await confirmDelivery("order-1", "buyer-1");

    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ template: "orderCompleteSeller" }),
    );
  });

  it("buyer email is addressed to buyer and contains listing title + order ID", async () => {
    await confirmDelivery("order-1", "buyer-1");

    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "orderCompleteBuyer",
        to: "buyer@test.nz",
        listingTitle: "Vintage Camera",
        orderId: "order-1",
        totalNzd: 12000,
      }),
    );
  });

  it("seller email is addressed to seller with payout timeline and buyer first name only", async () => {
    await confirmDelivery("order-1", "buyer-1");

    const sellerCall = (
      enqueueEmail as ReturnType<typeof vi.fn>
    ).mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { template: string }).template === "orderCompleteSeller",
    );

    expect(sellerCall).toBeDefined();
    const data = sellerCall![0] as Record<string, unknown>;

    expect(data.to).toBe("seller@test.nz");
    expect(data.payoutTimelineDays).toBeGreaterThan(0);
    // First name only — "Frank" from "Frank Brown"
    expect(data.buyerFirstName).toBe("Frank");
    expect(data.buyerFirstName as string).not.toContain("Brown");
  });

  it("uses enqueueEmail (async queue) not an inline send", async () => {
    await confirmDelivery("order-1", "buyer-1");

    // enqueueEmail was called (from @/lib/email-queue — the global mock)
    expect(enqueueEmail).toHaveBeenCalled();
    // The transport mock should NOT have been invoked
    expect(mockTransportSend).not.toHaveBeenCalled();
  });

  it("order completes successfully even when enqueueEmail throws", async () => {
    (enqueueEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Redis unavailable"),
    );

    // findPartiesForCompletionEmail will also throw — confirm the outer try/catch protects completion
    mockFindPartiesForCompletionEmail.mockRejectedValue(
      new Error("Redis unavailable"),
    );

    await expect(
      confirmDelivery("order-1", "buyer-1"),
    ).resolves.toBeUndefined();

    // Core transition still happened
    expect(mockTransitionOrder).toHaveBeenCalledWith(
      "order-1",
      "COMPLETED",
      expect.anything(),
      expect.anything(),
    );
  });

  it("order completes successfully when findPartiesForCompletionEmail returns null", async () => {
    mockFindPartiesForCompletionEmail.mockResolvedValue(null);

    await expect(
      confirmDelivery("order-1", "buyer-1"),
    ).resolves.toBeUndefined();

    // No email should be queued if parties lookup returns null
    const orderCompleteEmailCalls = (
      enqueueEmail as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c: unknown[]) =>
      ["orderCompleteBuyer", "orderCompleteSeller"].includes(
        (c[0] as { template: string }).template,
      ),
    );
    expect(orderCompleteEmailCalls).toHaveLength(0);
  });
});
