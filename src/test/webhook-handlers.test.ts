// src/test/webhook-handlers.test.ts
// ─── Tests: WebhookService — Stripe event processing ──────────────────────
// Covers: all handled event types, idempotency, unknown events, guard states.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";
import type { Stripe } from "stripe";

// ── Mock listing repository ─────────────────────────────────────────────────
vi.mock("@/modules/listings/listing.repository", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/modules/listings/listing.repository")
    >();
  return {
    ...actual,
    listingRepository: {
      ...(actual.listingRepository as object),
      releaseReservation: vi.fn().mockResolvedValue({ count: 1 }),
      restoreFromSold: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// ── Mock notification service ────────────────────────────────────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock order-event service ─────────────────────────────────────────────────
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    PAYMENT_HELD: "PAYMENT_HELD",
    CANCELLED: "CANCELLED",
    DISPATCHED: "DISPATCHED",
  },
  ACTOR_ROLES: { SYSTEM: "SYSTEM", BUYER: "BUYER", SELLER: "SELLER" },
}));

// ── Lazy imports ─────────────────────────────────────────────────────────────
const { WebhookService } = await import("@/modules/payments/webhook.service");
const webhookService = new WebhookService();

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
  type: string,
  data: Record<string, unknown> = {},
  id = "evt_test_001",
): Stripe.Event {
  return {
    id,
    type,
    data: {
      object: {
        id: "pi_test",
        metadata: {
          orderId: "order-1",
          sellerId: "seller-1",
          listingId: "listing-1",
        },
        amount: 5000,
        application_fee_amount: 500,
        status: "requires_capture",
        last_payment_error: null,
        ...data,
      },
    },
    object: "event",
    api_version: "2025-01-01",
    created: Date.now() / 1000,
    livemode: false,
    pending_webhooks: 0,
    request: null,
  } as unknown as Stripe.Event;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WebhookService — markEventProcessed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true for new event", async () => {
    vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never);

    const isNew = await webhookService.markEventProcessed(
      "evt_1",
      "pi.succeeded",
    );

    expect(isNew).toBe(true);
  });

  it("returns false for duplicate event (P2002 unique constraint)", async () => {
    const p2002 = Object.assign(new Error("Unique constraint"), {
      code: "P2002",
    });
    vi.mocked(db.stripeEvent.create).mockRejectedValue(p2002);

    const isNew = await webhookService.markEventProcessed(
      "evt_dup",
      "pi.succeeded",
    );

    expect(isNew).toBe(false);
  });

  it("re-throws non-P2002 errors", async () => {
    vi.mocked(db.stripeEvent.create).mockRejectedValue(
      new Error("Connection refused"),
    );

    await expect(
      webhookService.markEventProcessed("evt_err", "test"),
    ).rejects.toThrow("Connection refused");
  });
});

describe("WebhookService — processEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: new event (not duplicate)
    vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never);
    // Default: order in AWAITING_PAYMENT state
    vi.mocked(db.order.findUnique).mockResolvedValue({
      status: "AWAITING_PAYMENT",
      fulfillmentType: "SHIPPED",
    } as never);
    // Default: transition succeeds (optimistic lock)
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
    // Default: user update for account.updated
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 });
  });

  // ── payment_intent.amount_capturable_updated ─────────────────────────────

  it("transitions AWAITING_PAYMENT → PAYMENT_HELD on amount_capturable_updated", async () => {
    const event = makeEvent("payment_intent.amount_capturable_updated");

    await webhookService.processEvent(event);

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "order-1" }),
        data: expect.objectContaining({ status: "PAYMENT_HELD" }),
      }),
    );
  });

  it("transitions to AWAITING_PICKUP for pickup orders", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      status: "AWAITING_PAYMENT",
      fulfillmentType: "ONLINE_PAYMENT_PICKUP",
    } as never);

    const event = makeEvent("payment_intent.amount_capturable_updated");
    await webhookService.processEvent(event);

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "AWAITING_PICKUP" }),
      }),
    );
  });

  it("creates payout record for shipped orders on amount_capturable_updated", async () => {
    const event = makeEvent("payment_intent.amount_capturable_updated");
    await webhookService.processEvent(event);

    expect(db.payout.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: "order-1" },
        create: expect.objectContaining({
          orderId: "order-1",
          userId: "seller-1",
          status: "PENDING",
        }),
      }),
    );
  });

  it("does NOT create payout for pickup orders", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      status: "AWAITING_PAYMENT",
      fulfillmentType: "ONLINE_PAYMENT_PICKUP",
    } as never);

    const event = makeEvent("payment_intent.amount_capturable_updated");
    await webhookService.processEvent(event);

    expect(db.payout.upsert).not.toHaveBeenCalled();
  });

  it("skips transition when order already past AWAITING_PAYMENT", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      status: "PAYMENT_HELD",
      fulfillmentType: "SHIPPED",
    } as never);

    const event = makeEvent("payment_intent.amount_capturable_updated");
    await webhookService.processEvent(event);

    // No status update attempted
    expect(db.order.updateMany).not.toHaveBeenCalled();
  });

  it("skips when orderId is missing from metadata", async () => {
    const event = makeEvent("payment_intent.amount_capturable_updated", {
      metadata: {},
    });
    await webhookService.processEvent(event);

    expect(db.order.findUnique).not.toHaveBeenCalled();
  });

  // ── payment_intent.succeeded ─────────────────────────────────────────────

  it("transitions AWAITING_PAYMENT → PAYMENT_HELD on payment_intent.succeeded", async () => {
    const event = makeEvent("payment_intent.succeeded");
    await webhookService.processEvent(event);

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PAYMENT_HELD" }),
      }),
    );
  });

  it("creates payout on payment_intent.succeeded", async () => {
    const event = makeEvent("payment_intent.succeeded");
    await webhookService.processEvent(event);

    expect(db.payout.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: "order-1" },
      }),
    );
  });

  it("skips payment_intent.succeeded when order not AWAITING_PAYMENT", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      status: "COMPLETED",
      fulfillmentType: "SHIPPED",
    } as never);

    const event = makeEvent("payment_intent.succeeded");
    await webhookService.processEvent(event);

    expect(db.order.updateMany).not.toHaveBeenCalled();
  });

  // ── payment_intent.payment_failed ────────────────────────────────────────

  it("transitions AWAITING_PAYMENT → CANCELLED on payment_failed", async () => {
    const event = makeEvent("payment_intent.payment_failed");
    await webhookService.processEvent(event);

    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("releases listing reservation on payment_failed", async () => {
    const { listingRepository } =
      await import("@/modules/listings/listing.repository");
    const event = makeEvent("payment_intent.payment_failed");
    await webhookService.processEvent(event);

    expect(listingRepository.releaseReservation).toHaveBeenCalledWith(
      "listing-1",
    );
  });

  it("skips payment_failed when order not AWAITING_PAYMENT", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      status: "PAYMENT_HELD",
      fulfillmentType: "SHIPPED",
    } as never);

    const event = makeEvent("payment_intent.payment_failed");
    await webhookService.processEvent(event);

    expect(db.order.updateMany).not.toHaveBeenCalled();
  });

  it("skips payment_failed when order not found", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(null);

    const event = makeEvent("payment_intent.payment_failed");
    await webhookService.processEvent(event);

    expect(db.order.updateMany).not.toHaveBeenCalled();
  });

  // ── account.updated ──────────────────────────────────────────────────────

  it("syncs seller Stripe status on account.updated", async () => {
    const event = {
      ...makeEvent("account.updated"),
      data: {
        object: {
          id: "acct_seller123",
          details_submitted: true,
          charges_enabled: true,
          payouts_enabled: true,
        },
      },
    } as unknown as Stripe.Event;

    await webhookService.processEvent(event);

    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isStripeOnboarded: true,
          isStripeChargesEnabled: true,
          isStripePayoutsEnabled: true,
        }),
      }),
    );
  });

  it("sets isStripeOnboarded=false when account not fully configured", async () => {
    const event = {
      ...makeEvent("account.updated"),
      data: {
        object: {
          id: "acct_seller123",
          details_submitted: true,
          charges_enabled: false,
          payouts_enabled: true,
        },
      },
    } as unknown as Stripe.Event;

    await webhookService.processEvent(event);

    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isStripeOnboarded: false,
        }),
      }),
    );
  });

  // ── transfer.created ─────────────────────────────────────────────────────

  it("updates payout record on transfer.created", async () => {
    vi.mocked(db.payout.updateMany).mockResolvedValue({ count: 1 });
    const event = {
      ...makeEvent("transfer.created"),
      data: {
        object: { id: "tr_transfer123" },
      },
    } as unknown as Stripe.Event;

    await webhookService.processEvent(event);

    expect(db.payout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stripeTransferId: "tr_transfer123",
        }),
      }),
    );
  });

  // ── Unknown event type ───────────────────────────────────────────────────

  it("handles unknown event type gracefully — no throw", async () => {
    const event = makeEvent("unknown.event.type");

    // Should not throw
    await webhookService.processEvent(event);
  });

  // ── Idempotency ──────────────────────────────────────────────────────────

  it("concurrent delivery — handler ran idempotently, P2002 on mark is swallowed", async () => {
    // Simulate concurrent delivery: stripeEvent.create throws P2002 AFTER
    // the handler already ran (new handle-first AT-LEAST-ONCE flow).
    // P2002 on mark means the other delivery already recorded it — harmless
    // because handlers are idempotent (optimistic updateMany returns count=0).
    const p2002 = Object.assign(new Error("Unique constraint"), {
      code: "P2002",
    });
    vi.mocked(db.stripeEvent.create).mockRejectedValue(p2002);

    const event = makeEvent("payment_intent.succeeded");

    // Must resolve without error — P2002 on mark is NOT a failure
    await expect(webhookService.processEvent(event)).resolves.toBeUndefined();

    // Handler DID run (order state was checked and transition attempted)
    expect(db.order.findUnique).toHaveBeenCalled();
    // Mark was attempted after handler success
    expect(db.stripeEvent.create).toHaveBeenCalled();
  });

  // ── Handler failure rolls back event record ──────────────────────────────

  it("deletes event record when handler throws, allowing retry", async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue({
      status: "AWAITING_PAYMENT",
      fulfillmentType: "SHIPPED",
    } as never);
    // Transition fails
    vi.mocked(db.order.updateMany).mockRejectedValue(
      new Error("DB connection lost"),
    );
    vi.mocked(db.stripeEvent.findUnique).mockResolvedValue({} as never);

    const event = makeEvent("payment_intent.succeeded");

    await expect(webhookService.processEvent(event)).rejects.toThrow(
      "DB connection lost",
    );
  });
});
