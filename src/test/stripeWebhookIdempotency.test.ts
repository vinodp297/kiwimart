// src/test/stripeWebhookIdempotency.test.ts
// ─── Tests: Redis-based idempotency in the Stripe webhook route ───────────────
// Covers:
//   1. First occurrence — processes normally and marks as processed
//   2. Duplicate event (same ID) — returns 200, skips business logic
//   3. Duplicate detection uses the correct Redis key format
//   4. After successful processing, Redis key is set with 72-hour TTL
//   5. Redis unavailable during check — processes anyway (fail open), logs warn
//   6. Redis unavailable during mark — logs error but still returns 200
//   7. Failed processing — does NOT mark as processed in Redis
//   8. Signature verification still happens BEFORE idempotency check

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockRedisGet,
  mockRedisSet,
  mockProcessEvent,
  mockConstructEvent,
  mockGetRequestContext,
  mockLoggerWarn,
  mockLoggerError,
  mockLoggerInfo,
} = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
  mockProcessEvent: vi.fn(),
  mockConstructEvent: vi.fn(),
  mockGetRequestContext: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    webhooks: {
      constructEvent: (...args: unknown[]) => mockConstructEvent(...args),
    },
  },
}));

vi.mock("@/modules/payments/webhook.service", () => ({
  webhookService: {
    processEvent: (...args: unknown[]) => mockProcessEvent(...args),
  },
}));

vi.mock("@/lib/request-context", () => ({
  getRequestContext: () => mockGetRequestContext(),
}));

vi.mock("@/shared/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    fatal: vi.fn(),
  },
}));

// next/headers — return a fake stripe-signature header
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: (name: string) => (name === "stripe-signature" ? "t=1,v1=sig" : null),
  }),
}));

// ── Import the handler AFTER all mocks ────────────────────────────────────────
const { POST } = await import("@/app/api/webhooks/stripe/route");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body = "{}") {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: {
      "stripe-signature": "t=1,v1=sig",
      "Content-Type": "application/json",
    },
  });
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_test_001",
    type: "payment_intent.succeeded",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Stripe webhook — Redis idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: valid event
    mockConstructEvent.mockReturnValue(makeEvent());
    // Default: not yet processed
    mockRedisGet.mockResolvedValue(null);
    // Default: Redis set succeeds
    mockRedisSet.mockResolvedValue("OK");
    // Default: processEvent succeeds
    mockProcessEvent.mockResolvedValue(undefined);
    // Default: correlationId available
    mockGetRequestContext.mockReturnValue({ correlationId: "corr-test-abc" });
  });

  // ── Test 1 ────────────────────────────────────────────────────────────────
  it("processes first occurrence normally and marks as processed", async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // Business logic was called
    expect(mockProcessEvent).toHaveBeenCalledTimes(1);

    // Redis key was set after processing
    expect(mockRedisSet).toHaveBeenCalledWith(
      "stripe:webhook:processed:evt_test_001",
      expect.any(String),
      { ex: 259_200 },
    );
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  it("returns 200 immediately for duplicate event and skips business logic", async () => {
    // Redis says it was already processed
    mockRedisGet.mockResolvedValue(
      JSON.stringify({
        processedAt: new Date().toISOString(),
        eventType: "payment_intent.succeeded",
        correlationId: "corr-original",
      }),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // Business logic must NOT run
    expect(mockProcessEvent).not.toHaveBeenCalled();
    // Redis must NOT be overwritten
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  it("uses the correct Redis key format for idempotency lookup", async () => {
    mockConstructEvent.mockReturnValue(makeEvent({ id: "evt_unique_xyz" }));

    await POST(makeRequest());

    // Check that get was called with the exact key pattern
    expect(mockRedisGet).toHaveBeenCalledWith(
      "stripe:webhook:processed:evt_unique_xyz",
    );
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  it("stores JSON metadata with 72-hour TTL after successful processing", async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent({ id: "evt_meta_001", type: "checkout.session.completed" }),
    );
    mockGetRequestContext.mockReturnValue({ correlationId: "corr-meta-999" });

    await POST(makeRequest());

    expect(mockRedisSet).toHaveBeenCalledWith(
      "stripe:webhook:processed:evt_meta_001",
      expect.any(String),
      { ex: 259_200 },
    );

    // Verify the stored JSON shape
    const storedJson = mockRedisSet.mock.calls[0]?.[1] as string;
    const stored = JSON.parse(storedJson) as Record<string, unknown>;
    expect(stored).toMatchObject({
      processedAt: expect.any(String),
      eventType: "checkout.session.completed",
      correlationId: "corr-meta-999",
    });
    // processedAt should be a valid ISO date
    expect(
      new Date(stored.processedAt as string).getFullYear(),
    ).toBeGreaterThan(2020);
  });

  // ── Test 5 ────────────────────────────────────────────────────────────────
  it("fails open when Redis is unavailable during idempotency check", async () => {
    mockRedisGet.mockRejectedValue(new Error("ECONNREFUSED — Redis down"));

    const res = await POST(makeRequest());

    // Should still process the event
    expect(mockProcessEvent).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);

    // Should log a warning about the unavailability
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "stripe.webhook.idempotency_check_failed",
      expect.objectContaining({ eventId: "evt_test_001" }),
    );
  });

  // ── Test 6 ────────────────────────────────────────────────────────────────
  it("logs error but still returns 200 when Redis mark fails after processing", async () => {
    mockRedisSet.mockRejectedValue(new Error("Redis write timeout"));

    const res = await POST(makeRequest());

    // Event was processed successfully
    expect(mockProcessEvent).toHaveBeenCalledTimes(1);
    // Still returns 200 — event was handled
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // Error was logged
    expect(mockLoggerError).toHaveBeenCalledWith(
      "stripe.webhook.idempotency_mark_failed",
      expect.objectContaining({ eventId: "evt_test_001" }),
    );
  });

  // ── Test 7 ────────────────────────────────────────────────────────────────
  it("does NOT mark as processed in Redis when business logic fails", async () => {
    mockProcessEvent.mockRejectedValue(new Error("Order fulfilment error"));

    const res = await POST(makeRequest());

    // Route should return 500
    expect(res.status).toBe(500);

    // Redis must NOT be written — Stripe should retry
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  // ── Test 8 ────────────────────────────────────────────────────────────────
  it("performs signature verification BEFORE the idempotency check", async () => {
    const callOrder: string[] = [];

    mockConstructEvent.mockImplementation(() => {
      callOrder.push("constructEvent");
      return makeEvent();
    });
    mockRedisGet.mockImplementation(async () => {
      callOrder.push("redisGet");
      return null;
    });

    await POST(makeRequest());

    const sigIndex = callOrder.indexOf("constructEvent");
    const redisIndex = callOrder.indexOf("redisGet");

    expect(sigIndex).toBeGreaterThanOrEqual(0);
    expect(redisIndex).toBeGreaterThan(sigIndex);
  });

  // ── Bonus: invalid signature returns 400 without touching Redis ───────────
  it("returns 400 for invalid signature and never touches Redis", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect(mockRedisGet).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockProcessEvent).not.toHaveBeenCalled();
  });

  // ── Fix 2 tests: correct order of operations ──────────────────────────────
  // Verifies process-first-then-mark order (crash-safe idempotency).

  it("handler failure → event NOT marked processed in Redis", async () => {
    // Simulate handler crash/failure
    mockProcessEvent.mockRejectedValue(
      new Error("Order fulfilment crashed mid-flight"),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    // Redis must NOT be written — Stripe will retry and the event will be processed
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it("handler success → Redis marked AFTER processEvent completes", async () => {
    const callOrder: string[] = [];

    mockProcessEvent.mockImplementation(async () => {
      callOrder.push("processEvent");
    });
    mockRedisSet.mockImplementation(async () => {
      callOrder.push("redisSet");
      return "OK";
    });

    await POST(makeRequest());

    // processEvent must come before redisSet — crash between them means retry
    expect(callOrder.indexOf("processEvent")).toBeLessThan(
      callOrder.indexOf("redisSet"),
    );
  });

  it("second identical event is skipped (idempotency still works after fix)", async () => {
    // Simulate Redis already having the event recorded
    mockRedisGet.mockResolvedValue(
      JSON.stringify({
        processedAt: new Date().toISOString(),
        eventType: "payment_intent.succeeded",
        correlationId: "corr-first-run",
      }),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(mockProcessEvent).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it("crash simulation: processEvent throws → Redis not written, Stripe can retry", async () => {
    // Simulates a server crash between processEvent and redis.set.
    // The handler throws before marking as processed.
    mockProcessEvent.mockRejectedValue(new Error("Simulated crash"));

    const res = await POST(makeRequest());

    // Handler failed → 500 → Stripe retries
    expect(res.status).toBe(500);
    // Redis key NOT set — event can be safely retried on the next Stripe attempt
    expect(mockRedisSet).not.toHaveBeenCalled();
    // On a real crash, the process exits — no markProcessed runs. Since we
    // use process-then-mark order, the next Stripe retry finds nothing in Redis
    // and processes the event fresh.
    expect(mockProcessEvent).toHaveBeenCalledTimes(1);
  });
});
