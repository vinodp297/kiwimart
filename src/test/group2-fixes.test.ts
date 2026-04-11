// src/test/group2-fixes.test.ts
// ─── Tests: Group 2 medium-complexity fixes ─────────────────────────────────
//
// Fix 2. Null PI resume — idempotency key reuse when Stripe call failed
// Fix 3. Step-up MFA auth — requireStepUpAuth / markStepUpVerified
// Fix 4. Metrics endpoint — /api/v1/metrics (admin only)
// Fix 5. TX threading — interaction + event written atomically

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { createMockLogger, createMockRedis } from "./fixtures";

vi.mock("server-only", () => ({}));

// Restore the real requireStepUpAuth so Fix 3 tests exercise the actual Redis logic.
// The global setup.ts mock (no-op) would otherwise swallow all calls.
vi.unmock("@/server/lib/requireStepUpAuth");

// ── Shared: userRepository mock (covers all fixes) ───────────────────────────

const mockFindEmailVerified = vi
  .fn()
  .mockResolvedValue({ emailVerified: true });
const mockFindStripeStatus = vi.fn();
const mockFindForApiAuth = vi.fn();

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findEmailVerified: (...a: unknown[]) => mockFindEmailVerified(...a),
    findStripeStatus: (...a: unknown[]) => mockFindStripeStatus(...a),
    findForApiAuth: (...a: unknown[]) => mockFindForApiAuth(...a),
  },
}));

// ── Shared: logger ───────────────────────────────────────────────────────────

vi.mock("@/shared/logger", () => ({
  logger: createMockLogger(),
}));

// ── Shared: Redis ─────────────────────────────────────────────────────────────

const _redis = createMockRedis();
const mockRedisGet = _redis.get;
const mockRedisSet = _redis.set;
const mockRedisDel = _redis.del;

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => _redis,
}));

// ── Shared: auth ─────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
}));

vi.mock("@/lib/mobile-auth", () => ({
  verifyMobileToken: vi.fn().mockResolvedValue(null),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 2 — Null PI resume
// ═══════════════════════════════════════════════════════════════════════════════

const mockCreatePaymentIntent = vi.fn();
const mockGetClientSecret = vi.fn();
const mockAttachPaymentIntent = vi.fn();

vi.mock("@/modules/payments/payment.service", () => ({
  paymentService: {
    createPaymentIntent: (...a: unknown[]) => mockCreatePaymentIntent(...a),
    getClientSecret: (...a: unknown[]) => mockGetClientSecret(...a),
  },
}));

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    paymentIntents: { retrieve: vi.fn(), create: vi.fn() },
    accounts: { retrieve: vi.fn() },
  },
}));

vi.mock("@/infrastructure/stripe/with-timeout", () => ({
  withStripeTimeout: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/server/services/listing-snapshot.service", () => ({
  captureListingSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order-create-helpers", () => ({
  handleCashOnPickup: vi.fn(),
  notifyOrderCreated: vi.fn(),
  schedulePickupDeadline: vi.fn(),
}));

vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn() },
  ORDER_EVENT_TYPES: { ORDER_CREATED: "ORDER_CREATED" },
  ACTOR_ROLES: { BUYER: "BUYER" },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn(),
}));

const mockFindByIdempotencyKey = vi.fn();

const mockCountMetrics = vi.fn().mockResolvedValue({
  awaitingPaymentStale: 0,
  paymentHeldStale: 0,
  disputedOpen: 0,
});

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findByIdempotencyKey: (...a: unknown[]) => mockFindByIdempotencyKey(...a),
    findListingForOrder: vi.fn(),
    attachPaymentIntent: (...a: unknown[]) => mockAttachPaymentIntent(...a),
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    setStripePaymentIntentId: vi.fn(),
    createEvent: vi.fn(),
    reserveListing: vi.fn().mockResolvedValue({ count: 0 }),
    countMetrics: (...a: unknown[]) => mockCountMetrics(...a),
  },
}));

import { orderRepository } from "@/modules/orders/order.repository";
import { createOrder } from "@/modules/orders/order-create.service";

describe("Fix 2 — Null PI resume on idempotency retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindEmailVerified.mockResolvedValue({ emailVerified: true });
    mockFindStripeStatus.mockResolvedValue({
      stripeAccountId: "acct_seller",
      isStripeOnboarded: true,
    });
    mockCreatePaymentIntent.mockResolvedValue({
      paymentIntentId: "pi_new",
      clientSecret: "cs_new",
    });
    mockAttachPaymentIntent.mockResolvedValue(undefined);
    vi.mocked(
      orderRepository.reserveListing as ReturnType<typeof vi.fn>,
    ).mockResolvedValue({ count: 0 });
  });

  it("resumes Stripe call and attaches PI when existing order has null stripePaymentIntentId", async () => {
    mockFindByIdempotencyKey.mockResolvedValue({
      id: "order-existing",
      status: "AWAITING_PAYMENT",
      stripePaymentIntentId: null,
      listingId: "listing-1",
      totalNzd: 5000,
      sellerId: "seller-1",
      listing: { title: "Test Widget" },
    });

    const result = await createOrder(
      "buyer-1",
      "buyer@test.nz",
      { listingId: "listing-1", idempotencyKey: "idem-key-1" },
      "1.2.3.4",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orderId).toBe("order-existing");
      expect(result.clientSecret).toBe("cs_new");
    }

    // Must use SAME idempotency key so Stripe deduplicates
    expect(mockCreatePaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "idem-key-1",
        orderId: "order-existing",
        amountNzd: 5000,
      }),
    );

    expect(mockAttachPaymentIntent).toHaveBeenCalledWith(
      "order-existing",
      "pi_new",
    );
  });

  it("returns existing clientSecret when PI already exists (existing path unaffected)", async () => {
    mockFindByIdempotencyKey.mockResolvedValue({
      id: "order-existing",
      status: "AWAITING_PAYMENT",
      stripePaymentIntentId: "pi_existing",
      listingId: "listing-1",
      totalNzd: 5000,
      sellerId: "seller-1",
      listing: { title: "Test Widget" },
    });
    mockGetClientSecret.mockResolvedValue("cs_existing");

    const result = await createOrder(
      "buyer-1",
      "buyer@test.nz",
      { listingId: "listing-1", idempotencyKey: "idem-key-2" },
      "1.2.3.4",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clientSecret).toBe("cs_existing");
    }
    // Must NOT call createPaymentIntent for existing PI
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 3 — Step-up MFA auth
// ═══════════════════════════════════════════════════════════════════════════════

import {
  requireStepUpAuth,
  markStepUpVerified,
  STEP_UP_TTL_SECONDS,
} from "@/server/lib/requireStepUpAuth";
import { AppError } from "@/shared/errors";

describe("Fix 3 — requireStepUpAuth / markStepUpVerified", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("markStepUpVerified sets Redis key mfa:step_up:{userId}:{action} with 300s TTL", async () => {
    mockRedisSet.mockResolvedValue("OK");

    await markStepUpVerified("user-1", "refund");

    expect(mockRedisSet).toHaveBeenCalledWith(
      "mfa:step_up:user-1:refund",
      "1",
      { ex: STEP_UP_TTL_SECONDS },
    );
    expect(STEP_UP_TTL_SECONDS).toBe(300);
  });

  it("requireStepUpAuth passes and deletes the key when step-up token exists", async () => {
    mockRedisGet.mockResolvedValue("1");
    mockRedisDel.mockResolvedValue(1);

    await expect(
      requireStepUpAuth("user-1", "account_delete"),
    ).resolves.toBeUndefined();

    expect(mockRedisGet).toHaveBeenCalledWith(
      "mfa:step_up:user-1:account_delete",
    );
    // Token must be consumed (deleted) to prevent replay
    expect(mockRedisDel).toHaveBeenCalledWith(
      "mfa:step_up:user-1:account_delete",
    );
  });

  it("requireStepUpAuth throws AppError 403 when token is absent (expired or never set)", async () => {
    mockRedisGet.mockResolvedValue(null);

    const err = await requireStepUpAuth("user-1", "password_change").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).code).toBe("STEP_UP_REQUIRED");
  });

  it("requireStepUpAuth does not delete key when token is absent", async () => {
    mockRedisGet.mockResolvedValue(null);

    await requireStepUpAuth("user-2", "refund").catch(() => null);

    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 4 — Metrics endpoint
// ═══════════════════════════════════════════════════════════════════════════════

vi.mock("@/lib/queue", () => ({
  QUEUE_MAP: {
    email: {
      getWaitingCount: vi.fn().mockResolvedValue(2),
      getFailedCount: vi.fn().mockResolvedValue(0),
    },
    payout: {
      getWaitingCount: vi.fn().mockResolvedValue(5),
      getFailedCount: vi.fn().mockResolvedValue(1),
    },
  },
  payoutQueue: { getFailedCount: vi.fn().mockResolvedValue(0) },
  emailQueue: { getFailedCount: vi.fn().mockResolvedValue(0) },
  getQueueConnection: vi.fn().mockReturnValue({}),
}));

import db from "@/lib/db";

const { GET } = await import("@/app/api/v1/metrics/route");

describe("Fix 4 — /api/v1/metrics endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
    mockFindEmailVerified.mockResolvedValue({ emailVerified: true });
    mockCountMetrics.mockResolvedValue({
      awaitingPaymentStale: 0,
      paymentHeldStale: 0,
      disputedOpen: 0,
    });
  });

  it("returns 403 for non-admin users", async () => {
    mockFindForApiAuth.mockResolvedValue({
      id: "user-1",
      isAdmin: false,
      isBanned: false,
    });

    const res = await GET(new Request("http://localhost/api/v1/metrics"));
    expect(res.status).toBe(403);
  });

  it("returns queue metrics with waiting and failed counts", async () => {
    mockFindForApiAuth.mockResolvedValue({
      id: "admin-1",
      isAdmin: true,
      isBanned: false,
    });

    const res = await GET(new Request("http://localhost/api/v1/metrics"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.queues).toBeDefined();
    expect(body.data.queues.email).toMatchObject({ waiting: 2, failed: 0 });
    expect(body.data.queues.payout).toMatchObject({ waiting: 5, failed: 1 });
  });

  it("returns order health metrics (awaitingPaymentStale, paymentHeldStale, disputedOpen)", async () => {
    mockFindForApiAuth.mockResolvedValue({
      id: "admin-1",
      isAdmin: true,
      isBanned: false,
    });

    mockCountMetrics.mockResolvedValue({
      awaitingPaymentStale: 3,
      paymentHeldStale: 1,
      disputedOpen: 5,
    });

    const res = await GET(new Request("http://localhost/api/v1/metrics"));
    const body = await res.json();

    expect(body.data.orders).toMatchObject({
      awaitingPaymentStale: 3,
      paymentHeldStale: 1,
      disputedOpen: 5,
    });
  });

  it("returns 200 with correct response envelope shape", async () => {
    mockFindForApiAuth.mockResolvedValue({
      id: "admin-1",
      isAdmin: true,
      isBanned: false,
    });

    const res = await GET(new Request("http://localhost/api/v1/metrics"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      queues: expect.any(Object),
      orders: expect.any(Object),
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 5 — TX threading: createInteraction + recordEvent atomic
// ═══════════════════════════════════════════════════════════════════════════════

import {
  OrderInteractionService,
  type CreateInteractionInput,
} from "@/modules/orders/order-interaction.service";

vi.mock("@/modules/orders/interaction.repository", () => ({
  interactionRepository: {
    findOrderForInteraction: vi.fn().mockResolvedValue({
      id: "order-3",
      buyerId: "buyer-3",
      sellerId: "seller-3",
      status: "PAYMENT_HELD",
    }),
    findPendingByTypeAndOrder: vi.fn().mockResolvedValue(null),
    createInteraction: vi.fn().mockResolvedValue({ id: "interaction-3" }),
  },
}));

describe("Fix 5 — createInteraction threads tx to all repo calls", () => {
  it("passes tx to findOrderForInteraction, findPendingByTypeAndOrder, and createInteraction", async () => {
    const { interactionRepository: ir } =
      await import("@/modules/orders/interaction.repository");
    const svc = new OrderInteractionService();
    const fakeTx = { _isTx: true } as never;

    const input: CreateInteractionInput = {
      orderId: "order-3",
      type: "CANCEL_REQUEST",
      initiatedById: "buyer-3",
      initiatorRole: "BUYER",
      reason: "Changed my mind",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      autoAction: "AUTO_APPROVE",
      tx: fakeTx,
    };

    await svc.createInteraction(input);

    expect(ir.findOrderForInteraction).toHaveBeenCalledWith("order-3", fakeTx);
    expect(ir.findPendingByTypeAndOrder).toHaveBeenCalledWith(
      "order-3",
      "CANCEL_REQUEST",
      fakeTx,
    );
    expect(ir.createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-3" }),
      fakeTx,
    );
  });

  it("works without tx (backward compatible — no tx param)", async () => {
    const svc = new OrderInteractionService();

    const input: CreateInteractionInput = {
      orderId: "order-3",
      type: "CANCEL_REQUEST",
      initiatedById: "buyer-3",
      initiatorRole: "BUYER",
      reason: "Changed my mind",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      autoAction: "AUTO_APPROVE",
      // tx intentionally omitted
    };

    const result = await svc.createInteraction(input);
    expect(result).toMatchObject({ id: "interaction-3" });
  });
});
