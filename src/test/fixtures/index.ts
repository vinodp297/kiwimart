// src/test/fixtures/index.ts
// ─── Shared Test Fixture Factories ───────────────────────────────────────────
// Type-safe factory functions for the three most frequently mocked
// infrastructure boundaries: structured logger, Redis client, and Prisma db.
//
// Usage:
//   import { createMockLogger, createMockRedis, createMockDb } from "./fixtures";
//
//   const mockLogger = createMockLogger();
//   vi.mock("@/shared/logger", () => ({ logger: mockLogger }));
//
//   const redis = createMockRedis();
//   vi.mock("@/infrastructure/redis/client", () => ({ getRedisClient: () => redis }));

import { vi } from "vitest";
import type { MockInstance } from "vitest";

// ── Logger factory ────────────────────────────────────────────────────────────

export type MockLogger = {
  debug: MockInstance;
  info: MockInstance;
  warn: MockInstance;
  error: MockInstance;
  fatal: MockInstance;
};

export function createMockLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

// ── Redis factory ─────────────────────────────────────────────────────────────

export type MockRedis = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
};

export function createMockRedis(): MockRedis {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    ping: vi.fn().mockResolvedValue("PONG"),
  };
}

// ── Prisma db factory ─────────────────────────────────────────────────────────
// Returns the same shape as the dbMock in setup.ts so individual tests can
// create fresh instances without the global mock bleeding across test files.

export function createMockDb() {
  return {
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
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
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
      updateMany: vi.fn(),
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
      count: vi.fn().mockResolvedValue(0),
    },
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "notif-1" }),
    },
    orderInteraction: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    message: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    messageThread: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    cart: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    cartItem: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
    },
    watchlistItem: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    blockedUser: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    verificationApplication: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "va-1" }),
    },
    passwordResetToken: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    erasureLog: {
      create: vi.fn().mockResolvedValue({ id: "erasure-log-1" }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    pushToken: {
      upsert: vi.fn().mockResolvedValue({ id: "pt-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn().mockImplementation(async (fnOrArray: unknown) => {
      if (typeof fnOrArray === "function") {
        return (fnOrArray as (tx: unknown) => Promise<unknown>)({});
      }
      return [];
    }),
    $queryRaw: vi.fn(),
  };
}

export type MockDb = ReturnType<typeof createMockDb>;
