// src/test/setup.ts
// ─── Global test setup for Vitest ────────────────────────────────────────────
// Mocks all external dependencies so unit tests run without DB, Stripe, etc.

import { vi, beforeEach } from "vitest";

// ── Mock Stripe ──────────────────────────────────────────────────────────────
// Use shared mock functions so ALL instances (including module-level ones in
// the source files) reference the same mocks. This lets tests control them.
const mockStripeCapture = vi
  .fn()
  .mockResolvedValue({ id: "pi_mock", status: "succeeded" });
const mockStripeCreate = vi
  .fn()
  .mockResolvedValue({ id: "pi_mock", client_secret: "cs_mock" });
const mockStripeRefund = vi.fn().mockResolvedValue({ id: "re_mock" });
const mockStripeRetrieve = vi
  .fn()
  .mockResolvedValue({
    id: "pi_mock",
    client_secret: "cs_mock",
    status: "succeeded",
  });

vi.mock("stripe", () => {
  class MockStripe {
    paymentIntents = {
      create: mockStripeCreate,
      capture: mockStripeCapture,
      retrieve: mockStripeRetrieve,
    };
    refunds = {
      create: mockStripeRefund,
    };
    webhooks = {
      constructEvent: vi.fn(),
    };
  }
  return { default: MockStripe };
});

// Export for test access (tests can import from this file)
export {
  mockStripeCapture,
  mockStripeCreate,
  mockStripeRefund,
  mockStripeRetrieve,
};

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => ({
  default: {
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ emailVerified: new Date("2025-01-01") }),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    listing: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    stripeEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    payout: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    report: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    offer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    review: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    orderEvent: {
      create: vi.fn().mockResolvedValue({ id: "evt-1" }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    platformConfig: {
      findUnique: vi.fn().mockResolvedValue({ value: "60" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    dispute: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "dispute-1" }),
      update: vi.fn().mockResolvedValue({}),
    },
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "notif-1" }),
    },
    orderInteraction: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    message: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    messageThread: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    watchlistItem: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    blockedUser: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    passwordResetToken: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (fnOrArray: unknown) => {
      if (typeof fnOrArray === "function") {
        // Execute the callback with the db mock as the transaction client
        // This is needed for tests that call code using $transaction(async (tx) => {...})
        const self = (await import("@/lib/db")).default;
        return (fnOrArray as (tx: unknown) => Promise<unknown>)(self);
      }
      return [];
    }),
    $queryRaw: vi.fn(),
  },
}));

// ── Mock platform-config ──────────────────────────────────────────────────────
// Provides sensible defaults so tests that use platform config don't hit the DB.
// Tests that need specific values can override getConfigInt/getConfigFloat locally.
const CONFIG_INT_DEFAULTS: Record<string, number> = {
  "financial.escrow.release_business_days": 4,
  "time.order.free_cancel_window_minutes": 60,
  "time.order.cancel_request_window_hours": 24,
  "time.dispute.open_window_days": 14,
  "financial.offer.min_percentage": 50,
  "time.offer.expiry_hours": 72,
  "time.dispute.seller_response_hours": 48,
  "time.dispute.cooling_period_hours": 24,
};

vi.mock("@/lib/platform-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-config")>();
  return {
    ...actual,
    getConfigInt: vi
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(CONFIG_INT_DEFAULTS[key] ?? 10),
      ),
    getConfigFloat: vi
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(CONFIG_INT_DEFAULTS[key] ?? 5.0),
      ),
    getConfigBool: vi.fn().mockResolvedValue(false),
    getConfigString: vi.fn().mockResolvedValue(""),
    getConfigJson: vi.fn().mockResolvedValue({}),
    getConfigMany: vi.fn().mockResolvedValue(new Map()),
  };
});

// ── Mock listing snapshot service ────────────────────────────────────────────
// captureListingSnapshot requires a full listing object with images/attrs etc.
// Most tests provide minimal listing mocks, so stub it out globally.
vi.mock("@/server/services/listing-snapshot.service", () => ({
  captureListingSnapshot: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock Cloudflare R2 storage ────────────────────────────────────────────────
vi.mock("@/infrastructure/storage/r2", () => ({
  r2: {
    send: vi.fn().mockResolvedValue({}),
  },
  R2_BUCKET: "test-bucket",
  R2_PUBLIC_URL: "https://test.r2.dev",
}));

// ── Mock Auth.js ─────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// ── Mock audit ───────────────────────────────────────────────────────────────
vi.mock("@/server/lib/audit", () => ({
  audit: vi.fn(),
}));

// ── Mock moderation ──────────────────────────────────────────────────────────
vi.mock("@/server/lib/moderation", () => ({
  moderateText: vi.fn().mockResolvedValue({ allowed: true, flagged: false }),
}));

// ── Mock next/headers ────────────────────────────────────────────────────────
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue("127.0.0.1"),
  }),
}));

// ── Mock next/cache ──────────────────────────────────────────────────────────
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// ── Mock queue ───────────────────────────────────────────────────────────────
vi.mock("@/lib/queue", () => ({
  payoutQueue: { add: vi.fn() },
  emailQueue: { add: vi.fn() },
}));

// ── Mock rate limiter ────────────────────────────────────────────────────────
vi.mock("@/server/lib/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

// ── Mock shared logger ───────────────────────────────────────────────────────
vi.mock("@/shared/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// ── Mock Pusher ──────────────────────────────────────────────────────────────
vi.mock("@/lib/pusher", () => ({
  getPusherServer: vi.fn().mockReturnValue({
    trigger: vi.fn().mockResolvedValue({}),
  }),
}));

// ── Mock server email ────────────────────────────────────────────────────────
vi.mock("@/server/email", () => ({
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock password ────────────────────────────────────────────────────────────
vi.mock("@/server/lib/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("$argon2id$hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

// ── Mock distributed lock ─────────────────────────────────────────────────────
// Makes withLock immediately invoke its callback so DB operations inside locks
// are exercised in tests without needing a Redis connection.
// acquireLock returns the NO_REDIS_LOCK sentinel so non-production code continues.
vi.mock("@/server/lib/distributedLock", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/lib/distributedLock")>();
  return {
    ...actual,
    withLock: vi
      .fn()
      .mockImplementation(async (_key: string, fn: () => Promise<unknown>) =>
        fn(),
      ),
    acquireLock: vi.fn().mockResolvedValue("NO_REDIS_LOCK"),
    releaseLock: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Mock user repository email verification ──────────────────────────────────
// Ensures tests that create orders don't fail on email verification check.
// Tests needing a non-verified user can override this locally.
vi.mock("@/modules/users/user.repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/users/user.repository")>();
  return {
    ...actual,
    userRepository: {
      ...(actual.userRepository as object),
      findEmailVerified: vi
        .fn()
        .mockResolvedValue({ emailVerified: new Date("2025-01-01") }),
    },
  };
});

// ── Restore $transaction implementation after each test ──────────────────────
// Some tests override db.$transaction with a custom mockImplementation.
// vi.clearAllMocks() only clears call history, not implementations — so the
// override bleeds into subsequent tests. This beforeEach re-applies the
// default callback-executing implementation so transitionOrder works correctly.
beforeEach(async () => {
  const db = (await import("@/lib/db")).default;
  vi.mocked(db.$transaction).mockImplementation(async (fnOrArray: unknown) => {
    if (typeof fnOrArray === "function") {
      return (fnOrArray as (tx: unknown) => Promise<unknown>)(db);
    }
    return [];
  });
});
