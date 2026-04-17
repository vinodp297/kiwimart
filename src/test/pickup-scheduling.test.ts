// src/test/pickup-scheduling.test.ts
// ─── Integration tests: Pickup Scheduling State Machine ──────────────────────

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import db from "@/lib/db";
import { createNotification } from "@/modules/notifications/notification.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
} from "@/modules/orders/order-event.service";
import { pickupQueue } from "@/lib/queue";
import { getConfigMany, getConfigInt } from "@/lib/platform-config";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { paymentService } from "@/modules/payments/payment.service";

// ─── vi.mock declarations (hoisted) ──────────────────────────────────────────

vi.mock("server-only", () => ({}));

// Override queue mock to include pickupQueue
vi.mock("@/lib/queue", () => ({
  payoutQueue: { add: vi.fn() },
  emailQueue: { add: vi.fn() },
  pickupQueue: {
    add: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/platform-config", () => ({
  CONFIG_KEYS: {
    PICKUP_MIN_LEAD_TIME_HOURS: "PICKUP_MIN_LEAD_TIME_HOURS",
    PICKUP_MAX_HORIZON_DAYS: "PICKUP_MAX_HORIZON_DAYS",
    PICKUP_WINDOW_MINUTES: "PICKUP_WINDOW_MINUTES",
    PICKUP_RESCHEDULE_RESPONSE_HOURS: "PICKUP_RESCHEDULE_RESPONSE_HOURS",
    PICKUP_RESCHEDULE_LIMIT: "PICKUP_RESCHEDULE_LIMIT",
    PICKUP_OTP_EXPIRY_MINUTES: "PICKUP_OTP_EXPIRY_MINUTES",
  },
  getConfigMany: vi.fn(),
  getConfigInt: vi.fn().mockResolvedValue(15),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: {
    ORDER_CREATED: "ORDER_CREATED",
    CANCELLED: "CANCELLED",
  },
  ACTOR_ROLES: {
    BUYER: "BUYER",
    SELLER: "SELLER",
  },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    refundPayment: vi.fn().mockResolvedValue({ id: "re_mock" }),
  },
}));

vi.mock("@/server/services/sms/sms.service", () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
  formatNzPhoneE164: vi.fn().mockImplementation((phone: string) => phone),
}));

// ─── Patch db with missing model (pickupRescheduleRequest not in setup.ts) ────

const mockPickupRescheduleRequest = {
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
};
(db as unknown as Record<string, unknown>).pickupRescheduleRequest =
  mockPickupRescheduleRequest;

// ─── Test helpers ─────────────────────────────────────────────────────────────

function setupPickupConfig() {
  vi.mocked(getConfigMany).mockResolvedValue(
    new Map([
      ["PICKUP_MIN_LEAD_TIME_HOURS", "2"],
      ["PICKUP_MAX_HORIZON_DAYS", "30"],
      ["PICKUP_WINDOW_MINUTES", "30"],
      ["PICKUP_RESCHEDULE_RESPONSE_HOURS", "12"],
      ["PICKUP_RESCHEDULE_LIMIT", "3"],
    ]) as never,
  );
  vi.mocked(getConfigInt).mockResolvedValue(15);
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "AWAITING_PICKUP",
    fulfillmentType: "ONLINE_PAYMENT_PICKUP",
    pickupStatus: "AWAITING_SCHEDULE",
    pickupScheduledAt: null,
    rescheduleCount: 0,
    stripePaymentIntentId: "pi_test123",
    totalNzd: 100,
    listingId: "listing-1",
    listing: { title: "Test Item", pickupAddress: "123 Test St" },
    ...overrides,
  };
}

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
}

// ─── Lazy service imports ─────────────────────────────────────────────────────

let proposePickupTime: (typeof import("@/server/services/pickup/pickup-proposal.service"))["proposePickupTime"];
let acceptPickupTime: (typeof import("@/server/services/pickup/pickup-proposal.service"))["acceptPickupTime"];
let requestReschedule: (typeof import("@/server/services/pickup/pickup-reschedule.service"))["requestReschedule"];
let respondToReschedule: (typeof import("@/server/services/pickup/pickup-reschedule-respond.service"))["respondToReschedule"];
let cancelPickupOrder: (typeof import("@/server/services/pickup/pickup-cancel.service"))["cancelPickupOrder"];
let generateAndSendOTP: (typeof import("@/server/services/pickup/pickup-otp.service"))["generateAndSendOTP"];
let verifyOTP: (typeof import("@/server/services/pickup/pickup-otp.service"))["verifyOTP"];

// ─────────────────────────────────────────────────────────────────────────────

describe("Pickup Scheduling State Machine", () => {
  beforeAll(async () => {
    const proposalMod =
      await import("@/server/services/pickup/pickup-proposal.service");
    proposePickupTime = proposalMod.proposePickupTime;
    acceptPickupTime = proposalMod.acceptPickupTime;

    const rescheduleMod =
      await import("@/server/services/pickup/pickup-reschedule.service");
    requestReschedule = rescheduleMod.requestReschedule;

    const respondMod =
      await import("@/server/services/pickup/pickup-reschedule-respond.service");
    respondToReschedule = respondMod.respondToReschedule;

    const cancelMod =
      await import("@/server/services/pickup/pickup-cancel.service");
    cancelPickupOrder = cancelMod.cancelPickupOrder;

    const otpMod = await import("@/server/services/pickup/pickup-otp.service");
    generateAndSendOTP = otpMod.generateAndSendOTP;
    verifyOTP = otpMod.verifyOTP;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupPickupConfig();

    // Re-apply implementations cleared by clearAllMocks
    vi.mocked(createNotification).mockResolvedValue(undefined);
    vi.mocked(pickupQueue.add).mockResolvedValue({} as never);
    vi.mocked(pickupQueue.remove).mockResolvedValue(undefined as never);
    vi.mocked(transitionOrder).mockResolvedValue(undefined as never);
    vi.mocked(paymentService.refundPayment).mockResolvedValue({
      id: "re_mock",
    } as never);
    mockPickupRescheduleRequest.updateMany.mockResolvedValue({ count: 0 });

    // $transaction: call callback synchronously with db as the tx
    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return (fn as (tx: typeof db) => Promise<unknown>)(db);
      }
      return [];
    });

    // Default thread / message mocks
    vi.mocked(db.messageThread.findFirst).mockResolvedValue(null);
    vi.mocked(db.messageThread.create).mockResolvedValue({
      id: "thread-1",
    } as never);
    vi.mocked(db.message.create).mockResolvedValue({ id: "msg-1" } as never);
    vi.mocked(db.messageThread.update).mockResolvedValue({
      id: "thread-1",
    } as never);
    vi.mocked(db.order.update).mockResolvedValue({} as never);
    vi.mocked(db.listing.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. PICKUP PROPOSAL
  // ──────────────────────────────────────────────────────────────────────────

  describe("1. Pickup Proposal", () => {
    it("buyer proposes valid pickup time successfully", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never);

      const result = await proposePickupTime({
        orderId: "order-1",
        proposedById: "buyer-1",
        proposedByRole: "BUYER",
        proposedTime: hoursFromNow(3),
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("sets pickupStatus to SCHEDULING on a valid proposal", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never);

      await proposePickupTime({
        orderId: "order-1",
        proposedById: "buyer-1",
        proposedByRole: "BUYER",
        proposedTime: hoursFromNow(3),
      });

      expect(db.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "order-1" },
          data: { pickupStatus: "SCHEDULING" },
        }),
      );
    });

    it("fails if proposed time is before minimum lead time (< 2 hours)", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never);

      const result = await proposePickupTime({
        orderId: "order-1",
        proposedById: "buyer-1",
        proposedByRole: "BUYER",
        proposedTime: hoursFromNow(1), // Only 1 hour ahead
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/at least 2 hours/i);
    });

    it("fails if proposed time is beyond the maximum horizon (> 30 days)", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never);

      const result = await proposePickupTime({
        orderId: "order-1",
        proposedById: "buyer-1",
        proposedByRole: "BUYER",
        proposedTime: daysFromNow(31),
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/30 days/i);
    });

    it("fails if order is not in AWAITING_PICKUP status", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeOrder({ status: "PAYMENT_COMPLETE" }) as never,
      );

      const result = await proposePickupTime({
        orderId: "order-1",
        proposedById: "buyer-1",
        proposedByRole: "BUYER",
        proposedTime: hoursFromNow(3),
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/pickup-eligible/i);
    });

    it("fails if proposer is not a party to the order", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never);

      const result = await proposePickupTime({
        orderId: "order-1",
        proposedById: "stranger-99",
        proposedByRole: "BUYER",
        proposedTime: hoursFromNow(3),
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not a party/i);
    });

    it("creates a PICKUP_PROPOSAL message card in the buyer/seller thread", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never);

      await proposePickupTime({
        orderId: "order-1",
        proposedById: "buyer-1",
        proposedByRole: "BUYER",
        proposedTime: hoursFromNow(3),
      });

      expect(db.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            threadId: "thread-1",
            senderId: "buyer-1",
            body: expect.stringContaining('"type":"PICKUP_PROPOSAL"'),
          }),
        }),
      );
    });

    it("creates a notification for the seller (other party)", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(makeOrder() as never);

      await proposePickupTime({
        orderId: "order-1",
        proposedById: "buyer-1",
        proposedByRole: "BUYER",
        proposedTime: hoursFromNow(3),
      });

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "seller-1",
          orderId: "order-1",
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. PICKUP ACCEPTANCE
  // ──────────────────────────────────────────────────────────────────────────

  describe("2. Pickup Acceptance", () => {
    function makeSchedulingOrder(overrides: Record<string, unknown> = {}) {
      return makeOrder({ pickupStatus: "SCHEDULING", ...overrides });
    }

    function makeProposalMsg(senderId: string, proposedTime: Date) {
      return {
        body: JSON.stringify({
          type: "PICKUP_PROPOSAL",
          proposedBy: "BUYER",
          proposedTime: proposedTime.toISOString(),
          location: "123 Test St",
        }),
        senderId,
      };
    }

    it("seller accepts proposed pickup time successfully via thread scan", async () => {
      const time = hoursFromNow(3);
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeSchedulingOrder() as never,
      );
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
      } as never);
      vi.mocked(db.message.findMany).mockResolvedValue([
        makeProposalMsg("buyer-1", time),
      ] as never);

      const result = await acceptPickupTime({
        orderId: "order-1",
        acceptedById: "seller-1",
      });

      expect(result.success).toBe(true);
    });

    it("updates order with confirmed pickup datetime and SCHEDULED status", async () => {
      const time = hoursFromNow(3);
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeSchedulingOrder() as never,
      );
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
      } as never);
      vi.mocked(db.message.findMany).mockResolvedValue([
        makeProposalMsg("buyer-1", time),
      ] as never);

      await acceptPickupTime({ orderId: "order-1", acceptedById: "seller-1" });

      expect(db.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "order-1" },
          data: expect.objectContaining({
            pickupStatus: "SCHEDULED",
            pickupScheduledAt: expect.any(Date),
            pickupWindowExpiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it("schedules PICKUP_WINDOW_EXPIRED job in pickupQueue", async () => {
      const time = hoursFromNow(3);
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeSchedulingOrder() as never,
      );
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
      } as never);
      vi.mocked(db.message.findMany).mockResolvedValue([
        makeProposalMsg("buyer-1", time),
      ] as never);

      await acceptPickupTime({ orderId: "order-1", acceptedById: "seller-1" });

      expect(pickupQueue.add).toHaveBeenCalledWith(
        "PICKUP_JOB",
        expect.objectContaining({
          type: "PICKUP_WINDOW_EXPIRED",
          orderId: "order-1",
        }),
        expect.objectContaining({ jobId: "pickup-window-order-1" }),
      );
    });

    it("creates a PICKUP_CONFIRMED message card in the thread", async () => {
      const time = hoursFromNow(3);
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeSchedulingOrder() as never,
      );
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
      } as never);
      vi.mocked(db.message.findMany).mockResolvedValue([
        makeProposalMsg("buyer-1", time),
      ] as never);

      await acceptPickupTime({ orderId: "order-1", acceptedById: "seller-1" });

      expect(db.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            body: expect.stringContaining('"type":"PICKUP_CONFIRMED"'),
          }),
        }),
      );
    });

    it("creates notifications for both buyer and seller", async () => {
      const time = hoursFromNow(3);
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeSchedulingOrder() as never,
      );
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
      } as never);
      vi.mocked(db.message.findMany).mockResolvedValue([
        makeProposalMsg("buyer-1", time),
      ] as never);

      await acceptPickupTime({ orderId: "order-1", acceptedById: "seller-1" });

      const notifiedIds = vi
        .mocked(createNotification)
        .mock.calls.map((c) => c[0].userId);
      expect(notifiedIds).toContain("buyer-1");
      expect(notifiedIds).toContain("seller-1");
    });

    it("fails if no pending proposal exists in the thread", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeSchedulingOrder() as never,
      );
      vi.mocked(db.messageThread.findFirst).mockResolvedValue({
        id: "thread-1",
      } as never);
      vi.mocked(db.message.findMany).mockResolvedValue([] as never);

      const result = await acceptPickupTime({
        orderId: "order-1",
        acceptedById: "seller-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no pickup proposal/i);
    });

    it("fails if acceptor tries to accept their own reschedule request", async () => {
      mockPickupRescheduleRequest.findUnique.mockResolvedValue({
        id: "req-1",
        orderId: "order-1",
        requestedById: "seller-1", // seller made this request
        proposedTime: hoursFromNow(3),
        status: "PENDING",
      });
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeSchedulingOrder() as never,
      );

      const result = await acceptPickupTime({
        orderId: "order-1",
        acceptedById: "seller-1", // same as requestedById
        rescheduleRequestId: "req-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cannot accept your own/i);
    });

    it("accepts pickup time via reschedule request ID and marks it ACCEPTED", async () => {
      const time = hoursFromNow(3);
      mockPickupRescheduleRequest.findUnique.mockResolvedValue({
        id: "req-1",
        orderId: "order-1",
        requestedById: "buyer-1",
        proposedTime: time,
        status: "PENDING",
      });
      mockPickupRescheduleRequest.update.mockResolvedValue({});
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeSchedulingOrder() as never,
      );

      const result = await acceptPickupTime({
        orderId: "order-1",
        acceptedById: "seller-1",
        rescheduleRequestId: "req-1",
      });

      expect(result.success).toBe(true);
      expect(mockPickupRescheduleRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "req-1" },
          data: expect.objectContaining({ status: "ACCEPTED" }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. PICKUP RESCHEDULING
  // ──────────────────────────────────────────────────────────────────────────

  describe("3. Pickup Rescheduling", () => {
    function makeScheduledOrder(overrides: Record<string, unknown> = {}) {
      return makeOrder({
        pickupStatus: "SCHEDULED",
        pickupScheduledAt: hoursFromNow(10),
        ...overrides,
      });
    }

    beforeEach(() => {
      mockPickupRescheduleRequest.create.mockResolvedValue({ id: "req-1" });
      mockPickupRescheduleRequest.update.mockResolvedValue({});
    });

    it("seller can request a reschedule with a valid reason", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder() as never,
      );

      const result = await requestReschedule({
        orderId: "order-1",
        requestedById: "seller-1",
        requestedByRole: "SELLER",
        sellerReason: "UNAVAILABLE" as never,
        proposedTime: hoursFromNow(6),
      });

      expect(result.success).toBe(true);
    });

    it("buyer can request a reschedule with a valid reason", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder() as never,
      );

      const result = await requestReschedule({
        orderId: "order-1",
        requestedById: "buyer-1",
        requestedByRole: "BUYER",
        buyerReason: "CHANGE_OF_PLANS" as never,
        proposedTime: hoursFromNow(6),
      });

      expect(result.success).toBe(true);
    });

    it("returns forceCancelAvailable when reschedule count reaches threshold", async () => {
      // rescheduleCount 2 → increments to 3 = FORCE_CANCEL_THRESHOLD
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder({ rescheduleCount: 2 }) as never,
      );

      const result = await requestReschedule({
        orderId: "order-1",
        requestedById: "seller-1",
        requestedByRole: "SELLER",
        sellerReason: "UNAVAILABLE" as never,
        proposedTime: hoursFromNow(6),
      });

      expect(result.success).toBe(true);
      expect(result.forceCancelAvailable).toBe(true);
    });

    it("fails if pickup is not in SCHEDULED status", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeOrder({ pickupStatus: "AWAITING_SCHEDULE" }) as never,
      );

      const result = await requestReschedule({
        orderId: "order-1",
        requestedById: "seller-1",
        requestedByRole: "SELLER",
        sellerReason: "UNAVAILABLE" as never,
        proposedTime: hoursFromNow(6),
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/confirmed pickup/i);
    });

    it("creates a PickupRescheduleRequest record in the database", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder() as never,
      );

      await requestReschedule({
        orderId: "order-1",
        requestedById: "seller-1",
        requestedByRole: "SELLER",
        sellerReason: "UNAVAILABLE" as never,
        proposedTime: hoursFromNow(6),
      });

      expect(mockPickupRescheduleRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: "order-1",
            requestedById: "seller-1",
            requestedByRole: "SELLER",
            proposedTime: expect.any(Date),
          }),
        }),
      );
    });

    it("creates a notification for the other party", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder() as never,
      );

      await requestReschedule({
        orderId: "order-1",
        requestedById: "seller-1",
        requestedByRole: "SELLER",
        sellerReason: "UNAVAILABLE" as never,
        proposedTime: hoursFromNow(6),
      });

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "buyer-1", orderId: "order-1" }),
      );
    });

    it("increments the reschedule count on the order", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder({ rescheduleCount: 1 }) as never,
      );

      await requestReschedule({
        orderId: "order-1",
        requestedById: "seller-1",
        requestedByRole: "SELLER",
        sellerReason: "UNAVAILABLE" as never,
        proposedTime: hoursFromNow(6),
      });

      expect(db.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rescheduleCount: 2 }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. RESCHEDULE RESPONSE
  // ──────────────────────────────────────────────────────────────────────────

  describe("4. Reschedule Response", () => {
    function makeReschedulingOrder(overrides: Record<string, unknown> = {}) {
      return makeOrder({
        pickupStatus: "RESCHEDULING",
        pickupScheduledAt: hoursFromNow(10),
        ...overrides,
      });
    }

    function makePendingRequest(overrides: Record<string, unknown> = {}) {
      return {
        id: "req-1",
        orderId: "order-1",
        requestedById: "buyer-1",
        requestedByRole: "BUYER",
        proposedTime: hoursFromNow(8),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        ...overrides,
      };
    }

    beforeEach(() => {
      mockPickupRescheduleRequest.update.mockResolvedValue({});
    });

    it("accepting reschedule updates order to SCHEDULED with the new proposed time", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeReschedulingOrder() as never,
      );
      mockPickupRescheduleRequest.findUnique.mockResolvedValue(
        makePendingRequest() as never,
      );

      const result = await respondToReschedule({
        orderId: "order-1",
        rescheduleRequestId: "req-1",
        respondedById: "seller-1",
        response: "ACCEPT",
      });

      expect(result.success).toBe(true);
      expect(db.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pickupStatus: "SCHEDULED",
            pickupScheduledAt: expect.any(Date),
          }),
        }),
      );
    });

    it("declining reschedule reverts order back to SCHEDULED", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeReschedulingOrder() as never,
      );
      mockPickupRescheduleRequest.findUnique.mockResolvedValue(
        makePendingRequest() as never,
      );

      const result = await respondToReschedule({
        orderId: "order-1",
        rescheduleRequestId: "req-1",
        respondedById: "seller-1",
        response: "REJECT",
      });

      expect(result.success).toBe(true);
      expect(db.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pickupStatus: "SCHEDULED" }),
        }),
      );
    });

    it("counter-proposal rejects original request and creates new pickup proposal", async () => {
      // proposePickupTime (called internally) also calls db.order.findUnique
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeOrder({
          pickupStatus: "RESCHEDULING",
          pickupScheduledAt: hoursFromNow(10),
        }) as never,
      );
      mockPickupRescheduleRequest.findUnique.mockResolvedValue(
        makePendingRequest() as never,
      );

      const result = await respondToReschedule({
        orderId: "order-1",
        rescheduleRequestId: "req-1",
        respondedById: "seller-1",
        response: "PROPOSE_ALTERNATIVE",
        alternativeTime: hoursFromNow(12),
      });

      expect(result.success).toBe(true);
      expect(mockPickupRescheduleRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "req-1" },
          data: expect.objectContaining({ status: "REJECTED" }),
        }),
      );
    });

    it("fails if the reschedule request does not exist", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeReschedulingOrder() as never,
      );
      mockPickupRescheduleRequest.findUnique.mockResolvedValue(null);

      const result = await respondToReschedule({
        orderId: "order-1",
        rescheduleRequestId: "req-nonexistent",
        respondedById: "seller-1",
        response: "ACCEPT",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it("fails if the responder is the same party who made the request", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeReschedulingOrder() as never,
      );
      mockPickupRescheduleRequest.findUnique.mockResolvedValue(
        makePendingRequest({ requestedById: "seller-1" }) as never, // seller made the request
      );

      const result = await respondToReschedule({
        orderId: "order-1",
        rescheduleRequestId: "req-1",
        respondedById: "seller-1", // same person trying to respond
        response: "ACCEPT",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/your own/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. PICKUP CANCELLATION
  // ──────────────────────────────────────────────────────────────────────────

  describe("5. Pickup Cancellation", () => {
    function makeScheduledOrder(overrides: Record<string, unknown> = {}) {
      return makeOrder({
        pickupStatus: "SCHEDULED",
        pickupScheduledAt: hoursFromNow(10),
        ...overrides,
      });
    }

    it("refunds payment for ONLINE_PAYMENT_PICKUP orders on cancellation", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder() as never,
      );

      await cancelPickupOrder({
        orderId: "order-1",
        cancelledById: "buyer-1",
        reason: "Changed my mind",
      });

      expect(paymentService.refundPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentIntentId: "pi_test123",
          orderId: "order-1",
        }),
      );
    });

    it("restores listing status from RESERVED to ACTIVE after cancellation", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder() as never,
      );

      await cancelPickupOrder({
        orderId: "order-1",
        cancelledById: "buyer-1",
        reason: "Changed my mind",
      });

      expect(db.listing.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "listing-1", status: "RESERVED" },
          data: { status: "ACTIVE" },
        }),
      );
    });

    it("cancels all pending reschedule requests on cancellation", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder() as never,
      );

      await cancelPickupOrder({
        orderId: "order-1",
        cancelledById: "buyer-1",
        reason: "Changed my mind",
      });

      expect(mockPickupRescheduleRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: "order-1", status: "PENDING" },
          data: { status: "CANCELLED" },
        }),
      );
    });

    it("records a CANCELLED order event", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder() as never,
      );

      await cancelPickupOrder({
        orderId: "order-1",
        cancelledById: "buyer-1",
        reason: "Changed my mind",
      });

      expect(orderEventService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: "order-1",
          type: ORDER_EVENT_TYPES.CANCELLED,
        }),
      );
    });

    it("notifies both buyer and seller on cancellation", async () => {
      vi.mocked(db.order.findUnique).mockResolvedValue(
        makeScheduledOrder() as never,
      );

      await cancelPickupOrder({
        orderId: "order-1",
        cancelledById: "buyer-1",
        reason: "Changed my mind",
      });

      const notifiedIds = vi
        .mocked(createNotification)
        .mock.calls.map((c) => c[0].userId);
      expect(notifiedIds).toContain("buyer-1");
      expect(notifiedIds).toContain("seller-1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. OTP VERIFICATION
  // ──────────────────────────────────────────────────────────────────────────

  describe("6. OTP Verification", () => {
    // OTP functions take a PrismaTransactionClient (`tx`) directly
    function makeMockTx() {
      return {
        order: {
          findUnique: vi.fn(),
          update: vi.fn().mockResolvedValue({}),
        },
        message: { create: vi.fn().mockResolvedValue({}) },
        messageThread: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "thread-1" }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
    }

    it("generateAndSendOTP returns success and sets pickupStatus to OTP_INITIATED", async () => {
      const tx = makeMockTx();

      const result = await generateAndSendOTP({
        orderId: "order-1",
        buyerPhone: "+6421000000",
        buyerName: "Test Buyer",
        listingTitle: "Test Item",
        tx: tx as never,
      });

      expect(result.success).toBe(true);
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "order-1" },
          data: expect.objectContaining({
            pickupStatus: "OTP_INITIATED",
            otpCodeHash: expect.any(String),
            otpExpiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it("OTP is stored as a SHA-256 hash, not as plaintext", async () => {
      const tx = makeMockTx();
      let savedHash: string | undefined;

      tx.order.update.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => {
          savedHash = data.otpCodeHash as string;
          return {};
        },
      );

      await generateAndSendOTP({
        orderId: "order-1",
        buyerPhone: "+6421000000",
        buyerName: "Test Buyer",
        listingTitle: "Test Item",
        tx: tx as never,
      });

      // SHA-256 hash is 64 hex characters — definitely not a 6-digit code
      expect(savedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("wrong OTP returns valid:false with an error message", async () => {
      const nodeCrypto = await import("crypto");
      const correctCode = "123456";
      const correctHash = nodeCrypto
        .createHash("sha256")
        .update(correctCode)
        .digest("hex");

      const tx = makeMockTx();
      tx.order.findUnique.mockResolvedValue({
        otpCodeHash: correctHash,
        otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        pickupStatus: "OTP_INITIATED",
      });

      const result = await verifyOTP({
        orderId: "order-1",
        enteredCode: "999999",
        tx: tx as never,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/incorrect code/i);
    });

    it("expired OTP returns valid:false with an expiry error", async () => {
      const nodeCrypto = await import("crypto");
      const code = "111111";
      const hash = nodeCrypto.createHash("sha256").update(code).digest("hex");

      const tx = makeMockTx();
      tx.order.findUnique.mockResolvedValue({
        otpCodeHash: hash,
        otpExpiresAt: new Date(Date.now() - 1000), // already expired
        pickupStatus: "OTP_INITIATED",
      });

      const result = await verifyOTP({
        orderId: "order-1",
        enteredCode: code,
        tx: tx as never,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/expired/i);
    });

    it("successful OTP verification clears otpCodeHash and otpExpiresAt fields", async () => {
      const nodeCrypto = await import("crypto");
      const code = "555555";
      const hash = nodeCrypto.createHash("sha256").update(code).digest("hex");

      const tx = makeMockTx();
      tx.order.findUnique.mockResolvedValue({
        otpCodeHash: hash,
        otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        pickupStatus: "OTP_INITIATED",
      });

      const result = await verifyOTP({
        orderId: "order-1",
        enteredCode: code,
        tx: tx as never,
      });

      expect(result.valid).toBe(true);
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "order-1" },
          data: expect.objectContaining({
            otpCodeHash: null,
            otpExpiresAt: null,
          }),
        }),
      );
    });

    it("OTP cannot be reused after a successful verification", async () => {
      const nodeCrypto = await import("crypto");
      const code = "777777";
      const hash = nodeCrypto.createHash("sha256").update(code).digest("hex");

      const tx = makeMockTx();

      // First call: valid OTP present
      // Second call: OTP fields cleared (simulating real state after first verify)
      tx.order.findUnique
        .mockResolvedValueOnce({
          otpCodeHash: hash,
          otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          pickupStatus: "OTP_INITIATED",
        })
        .mockResolvedValueOnce({
          otpCodeHash: null,
          // Keep a valid expiry so the expiry check doesn't fire first;
          // the null hash check is what should reject the second attempt.
          otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          pickupStatus: "OTP_INITIATED",
        });

      const first = await verifyOTP({
        orderId: "order-1",
        enteredCode: code,
        tx: tx as never,
      });
      expect(first.valid).toBe(true);

      const second = await verifyOTP({
        orderId: "order-1",
        enteredCode: code,
        tx: tx as never,
      });
      expect(second.valid).toBe(false);
      expect(second.error).toMatch(/no active otp/i);
    });
  });
});
