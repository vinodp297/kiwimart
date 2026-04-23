// src/test/group1-fixes.test.ts
// ─── Tests: Group 1 production-audit fixes ───────────────────────────────────
//   Fix 1. X-XSS-Protection header set to "0" (disables legacy XSS auditor)
//   Fix 2. Payout worker email failure enqueues retry via BullMQ (fireAndForget)
//   Fix 3. BullMQ queue health check in /api/health — degraded when failedJobs > 10
//   Fix 4. idempotencyKey composite unique per buyer (@@unique([buyerId, idempotencyKey]))

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import { createMockLogger } from "./fixtures";

// ═══════════════════════════════════════════════════════════════════════════
// Fix 1 — X-XSS-Protection header value
// ═══════════════════════════════════════════════════════════════════════════

// Proxy-specific mocks (match proxy.test.ts pattern)
vi.mock("@/lib/auth", () => ({
  auth: (handler: (...args: unknown[]) => unknown) => handler,
}));

vi.mock("server-only", () => ({}));

vi.mock("crypto", () => ({
  default: {
    randomBytes: () => ({ toString: () => "test-nonce" }),
    randomUUID: () => "test-uuid-1234",
  },
  randomBytes: () => ({ toString: () => "test-nonce" }),
  randomUUID: () => "test-uuid-1234",
}));

vi.mock("@/server/lib/sessionStore", () => ({
  getSessionVersion: vi.fn().mockResolvedValue(0),
}));

import { proxy } from "@/proxy";
import db from "@/lib/db";

describe("Fix 1 — X-XSS-Protection header", () => {
  it('sets X-XSS-Protection to "0" (disables legacy browser XSS auditor)', async () => {
    // Use an authenticated request to a public route — pass-through response carries
    // all security headers. Redirect responses are generated separately and don't
    // have the full header set applied by the proxy.
    const request = {
      nextUrl: new URL("/dashboard", "http://localhost:3000"),
      url: "http://localhost:3000/dashboard",
      method: "GET",
      headers: new Headers({ "user-agent": "test-agent" }),
      auth: {
        user: {
          id: "user-1",
          isSellerEnabled: false,
          isAdmin: false,
          isBanned: false,
          mfaPending: false,
        },
      },
    } as unknown as Parameters<typeof proxy>[0];

    const res = await proxy(request, {} as never);
    // Pass-through response (authenticated user on /dashboard passes through)
    expect(res?.headers.get("X-XSS-Protection")).toBe("0");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 2 — Payout worker email retry on failure
// ═══════════════════════════════════════════════════════════════════════════

// Capture the payout worker processor
let payoutProcessor: (job: unknown) => Promise<unknown>;

vi.mock("bullmq", () => ({
  Worker: class {
    constructor(name: string, processor: (job: unknown) => Promise<unknown>) {
      if (name === "payout") payoutProcessor = processor;
    }
    on(_event: string, _handler: unknown) {}
  },
}));

// Override global enqueueEmail mock with a spy we control per-test
const mockEnqueueEmail = vi.fn();
vi.mock("@/lib/email-queue", () => ({
  enqueueEmail: (...args: unknown[]) => mockEnqueueEmail(...args),
}));

const mockFireAndForget = vi.fn();
vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: (...args: unknown[]) => mockFireAndForget(...args),
}));

vi.mock("@/lib/request-context", () => ({
  runWithRequestContext: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  getRequestContext: () => null,
}));

vi.mock("@/server/lib/distributedLock", () => ({
  withLockAndHeartbeat: (
    _key: string,
    fn: () => Promise<unknown>,
    _opts?: unknown,
  ) => fn(),
}));

vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));

vi.mock("@/shared/logger", () => ({
  logger: createMockLogger(),
}));

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    accounts: {
      retrieve: vi
        .fn()
        .mockResolvedValue({ id: "acct_123", payouts_enabled: true }),
    },
    transfers: {
      create: vi.fn().mockResolvedValue({ id: "tr_123" }),
    },
  },
}));

vi.mock("@/infrastructure/stripe/with-timeout", () => ({
  withStripeTimeout: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/modules/payments/fee-calculator", () => ({
  calculateFees: vi.fn().mockResolvedValue({
    grossAmountCents: 5000,
    stripeFee: 125,
    platformFee: 175,
    platformFeeRate: 0.035,
    sellerPayout: 4700,
    tier: "STANDARD",
    requiresManualReview: false,
  }),
  calculateFeesFromBps: vi.fn().mockReturnValue({
    grossAmountCents: 5000,
    stripeFee: 125,
    platformFee: 175,
    platformFeeRate: 0.035,
    sellerPayout: 4700,
    tier: "STANDARD",
    requiresManualReview: false,
  }),
  calculateFeesSync: vi.fn(),
}));

vi.mock("@/modules/payments/payout.repository", () => ({
  payoutRepository: {
    findByOrderId: vi.fn().mockResolvedValue({
      id: "payout-1",
      status: "PENDING",
      amountNzd: 5000,
      effectiveFeeRateBps: 0,
    }),
    markProcessingWithTransfer: vi.fn().mockResolvedValue(undefined),
    markManualReview: vi.fn().mockResolvedValue(undefined),
    snapshotFeeRate: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findSellerForPayout: vi.fn().mockResolvedValue({
      email: "seller@test.nz",
      displayName: "Dave",
      sellerTierOverride: null,
      stripeAccountId: "acct_123",
    }),
  },
}));

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findListingTitleForOrder: vi.fn().mockResolvedValue("Test Widget"),
  },
}));

import { startPayoutWorker } from "@/server/workers/payoutWorker";

startPayoutWorker();

const PAYOUT_JOB = {
  id: "job-1",
  data: {
    orderId: "order-1",
    sellerId: "seller-1",
    amountNzd: 5000,
    stripeAccountId: "acct_123",
  },
};

describe("Fix 2 — payout worker email retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Happy path: enqueueEmail resolves on second call (the retry)
    mockEnqueueEmail.mockResolvedValue(undefined);
  });

  it("enqueues email via BullMQ on the happy path", async () => {
    await payoutProcessor(PAYOUT_JOB);
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "payoutInitiated",
        to: "seller@test.nz",
        sellerName: "Dave",
        amountNzd: 4700,
        orderId: "order-1",
      }),
    );
  });

  it("calls fireAndForget with retry enqueueEmail when initial email fails", async () => {
    // First call (in try block) throws; second call (in catch via fireAndForget) succeeds
    mockEnqueueEmail.mockRejectedValueOnce(new Error("Redis timeout"));

    await payoutProcessor(PAYOUT_JOB);

    // fireAndForget was called with a promise and the retry context label
    expect(mockFireAndForget).toHaveBeenCalledWith(
      expect.any(Promise),
      "payout.email_retry_enqueue",
    );
  });

  it("does not rethrow when email fails — payout transfer already committed", async () => {
    mockEnqueueEmail.mockRejectedValueOnce(new Error("Email service down"));

    // Must resolve (not throw) so BullMQ marks job complete, not failed
    await expect(payoutProcessor(PAYOUT_JOB)).resolves.toEqual(
      expect.objectContaining({ transferId: "tr_123" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 3 — BullMQ queue health check
// ═══════════════════════════════════════════════════════════════════════════

const mockPayoutGetFailedCount = vi.fn();
const mockEmailGetFailedCount = vi.fn();
const mockRedisPing = vi.fn();

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({ ping: mockRedisPing }),
}));

// Override global queue mock for this file to expose getFailedCount
vi.mock("@/lib/queue", () => ({
  payoutQueue: {
    getFailedCount: (...a: unknown[]) => mockPayoutGetFailedCount(...a),
  },
  emailQueue: {
    getFailedCount: (...a: unknown[]) => mockEmailGetFailedCount(...a),
  },
  getQueueConnection: vi.fn().mockReturnValue({}),
  // Stub per-queue configs — workers import the backoffStrategy at construction.
  EMAIL_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  IMAGE_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  PAYOUT_QUEUE_CONFIG: { backoffStrategy: () => 0 },
  PICKUP_QUEUE_CONFIG: { backoffStrategy: () => 0 },
}));

const { GET } = await import("@/app/api/health/route");

// Queue health was moved from /api/health (liveness) to /api/ready (readiness).
// /api/health is a pure liveness probe — it must not expose queue state so that
// load-balancer routing decisions are delegated entirely to /api/ready.
describe("Fix 3 — BullMQ queue health moved to /api/ready (not in /api/health)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore DB mock implementation after clearAllMocks clears one-time overrides
    vi.mocked(db.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
    mockRedisPing.mockResolvedValue("PONG");
    mockPayoutGetFailedCount.mockResolvedValue(0);
    mockEmailGetFailedCount.mockResolvedValue(0);
  });

  it("/api/health response does not contain checks.queue (queue is a readiness concern)", async () => {
    mockPayoutGetFailedCount.mockResolvedValue(5);
    mockEmailGetFailedCount.mockResolvedValue(3);

    const res = await GET(new Request("http://localhost/api/health"));
    const body = await res.json();

    // Queue check belongs to /api/ready — not present in liveness probe
    expect(body.checks).not.toHaveProperty("queue");
    expect(body.status).toBe("ok");
    expect(res.status).toBe(200);
  });

  it("/api/health returns ok even when queue has many failed jobs (queue does not affect liveness)", async () => {
    mockPayoutGetFailedCount.mockResolvedValue(11);
    mockEmailGetFailedCount.mockResolvedValue(50);

    const res = await GET(new Request("http://localhost/api/health"));
    const body = await res.json();

    // Liveness is unaffected by queue failed-job counts
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks).not.toHaveProperty("queue");
  });

  it("/api/health always returns HTTP 200 regardless of queue state (liveness only)", async () => {
    // Even if queues are completely flooded, the process is alive
    mockPayoutGetFailedCount.mockResolvedValue(1000);
    mockEmailGetFailedCount.mockResolvedValue(1000);

    const res = await GET(new Request("http://localhost/api/health"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checks.database).toBe("ok");
    expect(body.checks.redis).toBe("ok");
    expect(body.checks).not.toHaveProperty("queue");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 4 — idempotencyKey composite unique scope
// ═══════════════════════════════════════════════════════════════════════════

import { cartRepository } from "@/modules/cart/cart.repository";

describe("Fix 4 — idempotencyKey scoped per buyer (composite unique)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
  });

  it("cartRepository.findIdempotentOrder uses buyerId_idempotencyKey compound accessor", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderMock = db.order as any;
    if (!orderMock.findUnique) orderMock.findUnique = vi.fn();
    orderMock.findUnique.mockResolvedValue(null);

    await cartRepository.findIdempotentOrder("idem-key-1", "buyer-abc");

    expect(orderMock.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          buyerId_idempotencyKey: {
            buyerId: "buyer-abc",
            idempotencyKey: "idem-key-1",
          },
        },
      }),
    );
  });
});
