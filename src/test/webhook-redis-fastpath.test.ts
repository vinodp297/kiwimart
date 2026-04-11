// src/test/webhook-redis-fastpath.test.ts
// ─── Tests: Redis fast-path in WebhookService.processEvent() ──────────────────
// Covers the GET-before + SETNX-after pattern:
//   1. First delivery — GET returns null → handler runs → SETNX written after
//   2. Duplicate delivery — GET returns non-null → handler skipped entirely
//   3. Redis unavailable during GET — falls through to DB path; no SETNX after
//   4. Handler throws — SETNX is NOT set, Redis key stays absent → retry works
//   5. Redis key format and TTL

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockRedisGet,
  mockRedisSet,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  mockCreateStripeEvent,
  mockFindForWebhookStatus,
} = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
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
    get: (...args: unknown[]) => mockRedisGet(...args),
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

describe("WebhookService.processEvent — Redis GET-before + SETNX-after fast-path", () => {
  let service: WebhookService;

  beforeEach(() => {
    service = new WebhookService();
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
    mockCreateStripeEvent.mockReset();
    // Default: first delivery (GET = null) and DB mark succeeds
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue("OK");
    mockCreateStripeEvent.mockResolvedValue(undefined);
  });

  it("first delivery: GET returns null → handler runs → SETNX written after", async () => {
    // GET returns null → key not yet set → first delivery
    mockRedisGet.mockResolvedValue(null);

    const event = makeEvent("evt_first");
    await service.processEvent(event);

    // GET was called first with the correct key
    expect(mockRedisGet).toHaveBeenCalledOnce();
    const [getKey] = mockRedisGet.mock.calls[0] as [string];
    expect(getKey).toBe("webhook:seen:evt_first");

    // Handler ran — markEventProcessed called createStripeEvent
    expect(mockCreateStripeEvent).toHaveBeenCalledOnce();

    // SETNX written AFTER handler success
    expect(mockRedisSet).toHaveBeenCalledOnce();
    const [setKey, setValue, setOpts] = mockRedisSet.mock.calls[0] as [
      string,
      string,
      { ex: number; nx: boolean },
    ];
    expect(setKey).toBe("webhook:seen:evt_first");
    expect(setValue).toBe("1");
    expect(setOpts.nx).toBe(true);
    expect(setOpts.ex).toBe(86_400); // 24 hours

    // fast-path log NOT emitted (this was a new event)
    expect(mockLoggerInfo).not.toHaveBeenCalledWith(
      "webhook.redis_fast_path_hit",
      expect.anything(),
    );
  });

  it("duplicate delivery: GET returns non-null → handler is skipped entirely", async () => {
    // GET returns "1" → key exists → duplicate
    mockRedisGet.mockResolvedValue("1");

    const event = makeEvent("evt_dupe");
    await service.processEvent(event);

    // Handler must NOT have run (createStripeEvent not called)
    expect(mockCreateStripeEvent).not.toHaveBeenCalled();
    // SETNX must NOT be called — key already exists
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it("duplicate delivery: logs webhook.redis_fast_path_hit", async () => {
    mockRedisGet.mockResolvedValue("1");

    const event = makeEvent("evt_dupe_log", "payment_intent.succeeded");
    await service.processEvent(event);

    expect(mockLoggerInfo).toHaveBeenCalledWith("webhook.redis_fast_path_hit", {
      eventId: "evt_dupe_log",
      type: "payment_intent.succeeded",
    });
  });

  it("Redis GET unavailable: falls through to DB path, SETNX NOT called after", async () => {
    // Redis.get throws — simulates Upstash being unreachable
    mockRedisGet.mockRejectedValue(new Error("ECONNREFUSED"));

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

    // SETNX must NOT be called — redisClient was set to null after GET failure
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it("handler throws: SETNX is NOT written — Redis key stays absent so Stripe retry succeeds", async () => {
    // GET returns null → first delivery
    mockRedisGet.mockResolvedValue(null);

    // Override account.updated handler by using an event type the handler
    // internally calls findForWebhookStatus — simulate it throwing
    const failingEvent = makeEvent("evt_handler_fail", "account.updated");

    // Patch updateByStripeAccountId to throw
    const { userRepository } = await import("@/modules/users/user.repository");
    vi.mocked(
      (userRepository as { updateByStripeAccountId: ReturnType<typeof vi.fn> })
        .updateByStripeAccountId,
    ).mockRejectedValueOnce(new Error("DB error"));

    await expect(service.processEvent(failingEvent)).rejects.toThrow(
      "DB error",
    );

    // SETNX must NOT have been called — key must not be written on failure
    expect(mockRedisSet).not.toHaveBeenCalled();

    // Handler error was logged
    expect(mockLoggerError).toHaveBeenCalledWith(
      "stripe.webhook.handler_failed",
      expect.objectContaining({ eventId: "evt_handler_fail" }),
    );
  });

  it("Redis key uses 24-hour TTL (86_400 seconds)", async () => {
    mockRedisGet.mockResolvedValue(null);

    await service.processEvent(makeEvent("evt_ttl"));

    const [, , opts] = mockRedisSet.mock.calls[0] as [
      string,
      string,
      { ex: number; nx: boolean },
    ];
    expect(opts.ex).toBe(86_400);
  });

  it("Redis key format: webhook:seen:{eventId}", async () => {
    mockRedisGet.mockResolvedValue(null);

    await service.processEvent(makeEvent("evt_key_format_xyz"));

    const [getKey] = mockRedisGet.mock.calls[0] as [string];
    expect(getKey).toBe("webhook:seen:evt_key_format_xyz");

    const [setKey] = mockRedisSet.mock.calls[0] as [string];
    expect(setKey).toBe("webhook:seen:evt_key_format_xyz");
  });

  it("SETNX failure after successful handler is non-fatal — logs warn but does not throw", async () => {
    mockRedisGet.mockResolvedValue(null);
    // POST-handler SETNX throws
    mockRedisSet.mockRejectedValue(new Error("Redis write timeout"));

    const event = makeEvent("evt_set_fail");
    // Must NOT reject — SETNX failure is non-fatal
    await expect(service.processEvent(event)).resolves.toBeUndefined();

    // Handler ran successfully
    expect(mockCreateStripeEvent).toHaveBeenCalledOnce();

    // Warn logged for the SETNX failure
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "webhook.redis_fast_path_set_failed",
      expect.objectContaining({ eventId: "evt_set_fail" }),
    );
  });
});
