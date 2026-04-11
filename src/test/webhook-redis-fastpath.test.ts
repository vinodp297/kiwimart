// src/test/webhook-redis-fastpath.test.ts
// ─── Tests: Redis SETNX fast-path in WebhookService.processEvent() ────────────
// Covers:
//   1. First delivery — Redis NX succeeds → handler runs
//   2. Duplicate delivery — Redis NX returns null → handler skipped
//   3. Redis unavailable — falls through to DB-backed path
//   4. Redis key uses 24h TTL
//   5. Fast-path hit is logged as webhook.redis_fast_path_hit

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockRedisSet,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  mockCreateStripeEvent,
  mockFindForWebhookStatus,
} = vi.hoisted(() => ({
  mockRedisSet: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  mockCreateStripeEvent: vi.fn(),
  mockFindForWebhookStatus: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

vi.mock("@/shared/logger", () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

vi.mock("@/server/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    createStripeEvent: (...args: unknown[]) => mockCreateStripeEvent(...args),
    findForWebhookStatus: (...args: unknown[]) =>
      mockFindForWebhookStatus(...args),
    $transaction: vi
      .fn()
      .mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
    updatePayoutByTransferId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    updateByStripeAccountId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/listings/listing.repository", () => ({
  listingRepository: {
    releaseReservation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/orders/order.transitions", () => ({
  transitionOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: { recordEvent: vi.fn().mockResolvedValue(undefined) },
  ORDER_EVENT_TYPES: {
    PAYMENT_HELD: "PAYMENT_HELD",
    CANCELLED: "CANCELLED",
  },
  ACTOR_ROLES: { SYSTEM: "SYSTEM" },
}));

// ── Import service after mocks ─────────────────────────────────────────────────

import { WebhookService } from "@/modules/payments/webhook.service";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(id = "evt_test_001", type = "account.updated") {
  return {
    id,
    type,
    data: {
      object: {
        // Minimal Stripe Account stub for account.updated
        id: "acct_test",
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
      },
    },
  } as unknown as import("stripe").Stripe.Event;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WebhookService.processEvent — Redis SETNX fast-path", () => {
  let service: WebhookService;

  beforeEach(() => {
    service = new WebhookService();
    mockRedisSet.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
    mockCreateStripeEvent.mockReset();
    // markEventProcessed calls createStripeEvent — default: new event (true)
    mockCreateStripeEvent.mockResolvedValue(undefined);
  });

  it("first delivery: Redis NX succeeds (returns 'OK') → handler runs", async () => {
    // Redis NX returns 'OK' → first delivery
    mockRedisSet.mockResolvedValue("OK");

    const event = makeEvent("evt_first");
    await service.processEvent(event);

    // Redis set was called with NX and 24h TTL
    expect(mockRedisSet).toHaveBeenCalledOnce();
    const [key, value, opts] = mockRedisSet.mock.calls[0] as [
      string,
      string,
      { ex: number; nx: boolean },
    ];
    expect(key).toBe("webhook:seen:evt_first");
    expect(value).toBe("1");
    expect(opts.nx).toBe(true);
    expect(opts.ex).toBe(86_400); // 24 hours

    // handler ran — markEventProcessed called createStripeEvent
    expect(mockCreateStripeEvent).toHaveBeenCalledOnce();

    // fast-path log NOT emitted (this was a new event)
    expect(mockLoggerInfo).not.toHaveBeenCalledWith(
      "webhook.redis_fast_path_hit",
      expect.anything(),
    );
  });

  it("duplicate delivery: Redis NX returns null → handler is skipped entirely", async () => {
    // Redis NX returns null → key already existed → duplicate
    mockRedisSet.mockResolvedValue(null);

    const event = makeEvent("evt_dupe");
    await service.processEvent(event);

    // Handler must NOT have run (createStripeEvent not called)
    expect(mockCreateStripeEvent).not.toHaveBeenCalled();
  });

  it("duplicate delivery: logs webhook.redis_fast_path_hit", async () => {
    mockRedisSet.mockResolvedValue(null);

    const event = makeEvent("evt_dupe_log", "payment_intent.succeeded");
    await service.processEvent(event);

    expect(mockLoggerInfo).toHaveBeenCalledWith("webhook.redis_fast_path_hit", {
      eventId: "evt_dupe_log",
      type: "payment_intent.succeeded",
    });
  });

  it("Redis unavailable: falls through to DB path and logs warning", async () => {
    // Redis.set throws — simulates Upstash being unreachable
    mockRedisSet.mockRejectedValue(new Error("ECONNREFUSED"));

    const event = makeEvent("evt_redis_down");
    await service.processEvent(event);

    // Warning logged
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "webhook.redis_fast_path_unavailable",
      expect.objectContaining({
        eventId: "evt_redis_down",
      }),
    );

    // Handler still ran (fell through to DB path)
    expect(mockCreateStripeEvent).toHaveBeenCalledOnce();
  });

  it("Redis key uses 24-hour TTL (86_400 seconds)", async () => {
    mockRedisSet.mockResolvedValue("OK");

    await service.processEvent(makeEvent("evt_ttl"));

    const [, , opts] = mockRedisSet.mock.calls[0] as [
      string,
      string,
      { ex: number; nx: boolean },
    ];
    expect(opts.ex).toBe(86_400);
  });

  it("Redis key format: webhook:seen:{eventId}", async () => {
    mockRedisSet.mockResolvedValue("OK");

    await service.processEvent(makeEvent("evt_key_format_xyz"));

    const [key] = mockRedisSet.mock.calls[0] as [string];
    expect(key).toBe("webhook:seen:evt_key_format_xyz");
  });
});
