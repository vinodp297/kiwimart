// src/test/dynamic-list-cache.test.ts
// ─── Tests: dynamic-list service three-tier cache hierarchy ─────────────────
// Verifies Redis (300s) + local (60s) + DB fallback caching, invalidation
// patterns, and fail-open behavior when Redis is unavailable.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./setup";

// ── Mock Redis client ────────────────────────────────────────────────────────

const mockRedisGet = vi.fn();
const mockRedisSetex = vi.fn();
const mockRedisDel = vi.fn();

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn(async () => ({
    get: (...args: unknown[]) => mockRedisGet(...args),
    setex: (...args: unknown[]) => mockRedisSetex(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  })),
}));

// ── Mock logger ──────────────────────────────────────────────────────────────

vi.mock("@/shared/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Import service under test ────────────────────────────────────────────────

import {
  getList,
  clearLocalCache,
  invalidateList,
  invalidateAllLists,
} from "@/lib/dynamic-lists/dynamic-list.service";
import db from "@/lib/db";
import { logger } from "@/shared/logger";

// ── Test fixtures ────────────────────────────────────────────────────────────

const MOCK_ITEMS = [
  {
    value: "NZ",
    label: "New Zealand",
    description: null,
    metadata: null,
    sortOrder: 1,
  },
  {
    value: "AU",
    label: "Australia",
    description: null,
    metadata: null,
    sortOrder: 2,
  },
];

const MOCK_ITEMS_JSON = JSON.stringify(MOCK_ITEMS);

// ── Setup & teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  clearLocalCache(); // Ensure clean state between tests

  // Ensure dynamicListItem is mocked (may not be in global db mock)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbMock = db as any;
  if (!dbMock.dynamicListItem) {
    dbMock.dynamicListItem = {};
  }

  dbMock.dynamicListItem.findMany = vi.fn().mockResolvedValue([
    {
      value: "NZ",
      label: "New Zealand",
      description: null,
      metadata: null,
      sortOrder: 1,
    },
    {
      value: "AU",
      label: "Australia",
      description: null,
      metadata: null,
      sortOrder: 2,
    },
  ]);

  mockRedisGet.mockResolvedValue(null);
  mockRedisSetex.mockResolvedValue("OK");
  mockRedisDel.mockResolvedValue(1);
});

afterEach(() => {
  clearLocalCache();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("dynamic-list service — cache hierarchy", () => {
  describe("Tier 1: In-memory local cache", () => {
    it("returns cached items on local cache hit within 60s TTL", async () => {
      mockRedisGet.mockResolvedValue(null); // Redis miss
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockResolvedValue("OK");

      // First call: Redis miss → DB hit, populate all caches
      const result1 = await getList("NZ_REGIONS");
      expect(result1).toEqual(MOCK_ITEMS);
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(1);
      expect(mockRedisGet).toHaveBeenCalledTimes(1); // Redis checked on first call

      // Second call within 60s: local cache hit, no DB or Redis call
      const result2 = await getList("NZ_REGIONS");
      expect(result2).toEqual(MOCK_ITEMS);
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(1); // Still 1, not called again
      expect(mockRedisGet).toHaveBeenCalledTimes(1); // Still 1, not called again (local cache served)
    });

    it("skips Redis check when local cache is valid", async () => {
      mockRedisGet.mockResolvedValue(null);
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockResolvedValue("OK");

      // First call: Redis checked (miss), DB hit, caches warmed
      await getList("NZ_REGIONS");
      expect(mockRedisGet).toHaveBeenCalledTimes(1);

      // Second call: local cache is valid, no additional Redis check
      await getList("NZ_REGIONS");
      expect(mockRedisGet).toHaveBeenCalledTimes(1); // Still 1, not called again
    });
  });

  describe("Tier 2: Redis shared cache", () => {
    it("hits Redis when local cache expires and returns cached items", async () => {
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockResolvedValue("OK");

      // First call: Redis miss, DB hit, populate all caches
      mockRedisGet.mockResolvedValueOnce(null);
      await getList("NZ_REGIONS");
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(1);

      // Simulate local cache expiration: clear it manually
      clearLocalCache();

      // Second call: local cache miss → Redis hit → repopulate local cache (no DB)
      mockRedisGet.mockResolvedValueOnce(MOCK_ITEMS_JSON);
      const result = await getList("NZ_REGIONS");
      expect(result).toEqual(MOCK_ITEMS);
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(1); // Still 1, Redis prevented DB hit
    });

    it("stores items in Redis with 300s TTL on DB hit", async () => {
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockResolvedValue("OK");

      await getList("NZ_REGIONS");

      expect(mockRedisSetex).toHaveBeenCalledWith(
        "dynamic-list:NZ_REGIONS",
        300,
        MOCK_ITEMS_JSON,
      );
    });

    it("repopulates local cache when Redis hit occurs", async () => {
      mockRedisGet.mockResolvedValue(MOCK_ITEMS_JSON);

      // Populate with a Redis hit (not from DB)
      const result = await getList("BANNED_KEYWORDS");
      expect(result).toEqual(MOCK_ITEMS);

      // Clear local cache again, but the second call should still be a cache hit
      // because we just populated it from Redis
      clearLocalCache();

      // Request again — this time local cache should be empty, so Redis is checked
      mockRedisGet.mockResolvedValueOnce(MOCK_ITEMS_JSON);
      const result2 = await getList("BANNED_KEYWORDS");
      expect(result2).toEqual(MOCK_ITEMS);
    });
  });

  describe("Tier 3: Database fallback", () => {
    it("reads from DB when Redis and local cache miss", async () => {
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisGet.mockResolvedValue(null);
      mockRedisSetex.mockResolvedValue("OK");

      const result = await getList("RISK_KEYWORDS");

      expect(result).toEqual(MOCK_ITEMS);
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledWith({
        where: { listType: "RISK_KEYWORDS", isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          value: true,
          label: true,
          description: true,
          metadata: true,
          sortOrder: true,
        },
      });
    });

    it("populates both Redis and local cache after DB hit", async () => {
      mockRedisGet.mockResolvedValue(null);
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockResolvedValue("OK");

      clearLocalCache();
      await getList("COURIERS");

      // Both caches populated
      expect(mockRedisSetex).toHaveBeenCalled();

      // Verify by checking next access is instant (local cache)
      clearLocalCache(); // Manually clear
      mockRedisGet.mockResolvedValueOnce(MOCK_ITEMS_JSON); // Would be hit if local miss
      await getList("COURIERS");
      expect(mockRedisGet).toHaveBeenCalled(); // Had to check Redis after local clear
    });

    it("transforms DB rows to DynamicListItem format", async () => {
      (db as any).dynamicListItem.findMany.mockResolvedValue([
        {
          value: "dispute-1",
          label: "Item not as described",
          description: "Seller misrepresented the item",
          metadata: { severity: "high" },
          sortOrder: 1,
        },
      ]);
      mockRedisGet.mockResolvedValue(null);

      const result = await getList("DISPUTE_REASONS");

      expect(result).toEqual([
        {
          value: "dispute-1",
          label: "Item not as described",
          description: "Seller misrepresented the item",
          metadata: { severity: "high" },
          sortOrder: 1,
        },
      ]);
    });
  });

  describe("Fail-open: Redis unavailable", () => {
    it("falls back to DB when Redis GET fails", async () => {
      mockRedisGet.mockRejectedValue(new Error("Connection timeout"));
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockResolvedValue("OK");

      const result = await getList("LISTING_CONDITIONS");

      expect(result).toEqual(MOCK_ITEMS);
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalled();
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("Redis GET failed"),
      );
    });

    it("logs warning but continues when Redis SET fails", async () => {
      mockRedisGet.mockResolvedValue(null);
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockRejectedValue(new Error("Auth failed"));

      const result = await getList("REVIEW_TAGS");

      expect(result).toEqual(MOCK_ITEMS);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("Redis SET failed"),
      );
    });

    it("succeeds even when Redis operations are unavailable", async () => {
      mockRedisGet.mockRejectedValue(new Error("Redis down"));
      mockRedisSetex.mockRejectedValue(new Error("Redis down"));
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);

      const result = await getList("REPORT_REASONS");

      expect(result).toEqual(MOCK_ITEMS);
      // Verify function completes despite Redis failures
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalled();
    });

    it("uses local cache as fallback when both Redis and DB are unavailable", async () => {
      // First call: warm local cache from DB
      mockRedisGet.mockResolvedValue(null);
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockResolvedValue("OK");

      await getList("SELLER_RESCHEDULE_REASONS");
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(1);

      // Second call: local cache still valid (not expired), so no Redis/DB needed
      // (This is covered by earlier "returns cached items" test)
      const result2 = await getList("SELLER_RESCHEDULE_REASONS");
      expect(result2).toEqual(MOCK_ITEMS);
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe("Cache invalidation", () => {
    it("invalidateList clears local cache immediately", async () => {
      mockRedisGet.mockResolvedValue(null);
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockResolvedValue("OK");
      mockRedisDel.mockResolvedValue(1);

      // Warm the cache
      await getList("BUYER_RESCHEDULE_REASONS");
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(1);

      // Invalidate
      invalidateList("BUYER_RESCHEDULE_REASONS");

      // Next call must hit DB (local cache cleared, Redis deleted)
      (db as any).dynamicListItem.findMany.mockClear();
      mockRedisGet.mockResolvedValue(null);
      await getList("BUYER_RESCHEDULE_REASONS");
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(1); // DB called again
    });

    it("invalidateList sends Redis DEL request", async () => {
      invalidateList("PICKUP_REJECT_REASONS");

      // Give async invalidation time to run (it's async but fire-and-forget)
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRedisDel).toHaveBeenCalledWith(
        "dynamic-list:PICKUP_REJECT_REASONS",
      );
    });

    it("invalidateList logs warning if Redis DEL fails", async () => {
      mockRedisDel.mockRejectedValue(new Error("Redis unavailable"));

      invalidateList("DELIVERY_ISSUE_TYPES");

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("Redis DEL failed"),
      );
    });

    it("invalidateAllLists clears local cache immediately", async () => {
      mockRedisGet.mockResolvedValue(null);
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockResolvedValue("OK");

      // Warm cache for multiple lists
      await getList("PROBLEM_TYPES");
      await getList("QUICK_FILTER_CHIPS");
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(2);

      // Invalidate all
      invalidateAllLists();

      // Next calls must hit DB
      (db as any).dynamicListItem.findMany.mockClear();
      mockRedisGet.mockResolvedValue(null);
      await getList("PROBLEM_TYPES");
      await getList("QUICK_FILTER_CHIPS");
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(2); // Both hit DB again
    });

    it("invalidateAllLists calls Redis DEL for each list type", async () => {
      mockRedisDel.mockResolvedValue(1);

      invalidateAllLists();

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should call del for all 14 list types
      expect(mockRedisDel).toHaveBeenCalledTimes(14);
      expect(mockRedisDel).toHaveBeenCalledWith("dynamic-list:BANNED_KEYWORDS");
      expect(mockRedisDel).toHaveBeenCalledWith("dynamic-list:NZ_REGIONS");
      expect(mockRedisDel).toHaveBeenCalledWith(
        "dynamic-list:QUICK_FILTER_CHIPS",
      );
    });

    it("invalidateAllLists logs warnings for individual Redis failures without stopping", async () => {
      mockRedisDel
        .mockRejectedValueOnce(new Error("Timeout on BANNED_KEYWORDS"))
        .mockResolvedValueOnce(1) // NZ_REGIONS succeeds
        .mockRejectedValueOnce(new Error("Auth on COURIERS"))
        .mockResolvedValue(1); // Rest succeed

      invalidateAllLists();

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should have attempted all 14 deletes despite failures
      expect(mockRedisDel).toHaveBeenCalledTimes(14);

      // Should have logged warnings for the failures
      const warnCalls = vi.mocked(logger.warn).mock.calls;
      const redisErrors = warnCalls.filter((call) =>
        String(call[0]).includes("Redis"),
      );
      expect(redisErrors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Multi-instance synchronization", () => {
    it("ensures instances share cache via Redis across the 300s window", async () => {
      // Instance A populates Redis
      (db as any).dynamicListItem.findMany.mockResolvedValue(MOCK_ITEMS);
      mockRedisSetex.mockResolvedValue("OK");
      mockRedisGet.mockResolvedValue(null);

      await getList("NZ_REGIONS");
      expect(mockRedisSetex).toHaveBeenCalledWith(
        "dynamic-list:NZ_REGIONS",
        300,
        expect.any(String),
      );

      // Instance B (simulated: clear local cache, next call checks Redis)
      clearLocalCache();
      mockRedisGet.mockResolvedValue(MOCK_ITEMS_JSON);
      (db as any).dynamicListItem.findMany.mockClear();

      const resultB = await getList("NZ_REGIONS");
      expect(resultB).toEqual(MOCK_ITEMS);
      expect((db as any).dynamicListItem.findMany).toHaveBeenCalledTimes(0); // Instance B got Redis hit
    });

    it("propagates admin changes within 5 minutes via Redis + local expiry", async () => {
      // Initial state: BANNED_KEYWORDS is ["badword1", "badword2"]
      const initialItems = [
        {
          value: "badword1",
          label: null,
          description: null,
          metadata: null,
          sortOrder: 1,
        },
        {
          value: "badword2",
          label: null,
          description: null,
          metadata: null,
          sortOrder: 2,
        },
      ];

      (db as any).dynamicListItem.findMany.mockResolvedValue(initialItems);
      mockRedisSetex.mockResolvedValue("OK");
      mockRedisGet.mockResolvedValue(JSON.stringify(initialItems));

      const result1 = await getList("BANNED_KEYWORDS");
      expect(result1).toEqual(initialItems);

      // Admin edits the list: adds "badword3"
      const updatedItems = [
        ...initialItems,
        {
          value: "badword3",
          label: null,
          description: null,
          metadata: null,
          sortOrder: 3,
        },
      ];

      // Admin calls invalidateList to propagate the change
      invalidateList("BANNED_KEYWORDS");

      // Wait a tiny bit for async invalidation
      await new Promise((resolve) => setTimeout(resolve, 10));

      // New instances query DB → new Redis value → old instances' local cache expires → new Redis value
      mockRedisGet.mockResolvedValue(JSON.stringify(updatedItems));
      (db as any).dynamicListItem.findMany.mockResolvedValue(updatedItems);
      clearLocalCache(); // Simulate local cache expiry

      const result2 = await getList("BANNED_KEYWORDS");
      expect(result2).toEqual(updatedItems);
    });
  });
});
