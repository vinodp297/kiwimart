// src/test/webhook-payout.test.ts
// ─── Tests: webhook payout amount calculation ─────────────────────────────────
// Verifies the Payout record is created with the correct amount from
// payment_intent events — no dead code multiplication, correct formula.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";

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
    },
  };
});

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: { PAYMENT_HELD: "PAYMENT_HELD", CANCELLED: "CANCELLED" },
  ACTOR_ROLES: { SYSTEM: "SYSTEM" },
}));

const { WebhookService } = await import("@/modules/payments/webhook.service");
const webhookService = new WebhookService();

// ── Helpers ──────────────────────────────────────────────────────────────────

interface PayoutCreateArgs {
  amountNzd?: number;
  platformFeeNzd?: number;
  stripeFeeNzd?: number;
  status?: string;
}

function makePaymentIntentEvent(
  type: string,
  amount: number,
  applicationFeeAmount: number | null,
) {
  return {
    id: `evt_${Date.now()}`,
    type,
    data: {
      object: {
        id: "pi_test",
        metadata: { orderId: "order-1", sellerId: "seller-1" },
        amount,
        application_fee_amount: applicationFeeAmount,
        status: "requires_capture",
        last_payment_error: null,
      },
    },
  } as never;
}

/**
 * Spy on the payout.upsert call within a $transaction and capture the
 * create arguments. Returns the captured args after the event is processed.
 */
async function processAndCapture(
  type: string,
  amount: number,
  applicationFeeAmount: number | null,
): Promise<PayoutCreateArgs> {
  let captured: PayoutCreateArgs = {};

  vi.mocked(db.$transaction).mockImplementationOnce(async (fn) => {
    const txMock = {
      ...db,
      payout: {
        upsert: vi
          .fn()
          .mockImplementation((args: { create: PayoutCreateArgs }) => {
            captured = args.create;
            return Promise.resolve({});
          }),
      },
    };
    return (fn as (tx: unknown) => Promise<unknown>)(txMock);
  });

  await webhookService.processEvent(
    makePaymentIntentEvent(type, amount, applicationFeeAmount),
  );

  return captured;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("webhook payout calculation — no * 1 dead code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.stripeEvent.create).mockResolvedValue({} as never);
    vi.mocked(db.order.findUnique).mockResolvedValue({
      status: "AWAITING_PAYMENT",
      fulfillmentType: "SHIPPED",
    } as never);
  });

  it("payout amountNzd equals pi.amount when application_fee_amount is 0", async () => {
    const created = await processAndCapture(
      "payment_intent.succeeded",
      5000,
      0,
    );
    expect(created.amountNzd).toBe(5000);
  });

  it("payout amountNzd equals pi.amount minus application_fee_amount when non-zero", async () => {
    const created = await processAndCapture(
      "payment_intent.succeeded",
      5000,
      500,
    );
    expect(created.amountNzd).toBe(4500); // 5000 - 500
  });

  it("payout platformFeeNzd stores application_fee_amount for reconciliation", async () => {
    const created = await processAndCapture(
      "payment_intent.succeeded",
      5000,
      250,
    );
    expect(created.platformFeeNzd).toBe(250);
  });
});
