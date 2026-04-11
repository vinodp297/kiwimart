// src/test/cache.test.ts
// ─── Tests for Redis cache helper ──────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCached, invalidateCache } from "@/server/lib/cache";
import { getRedisClient } from "@/infrastructure/redis/client";
import { createMockRedis } from "./fixtures";

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn(),
}));

describe("getCached", () => {
  const mockRedis = createMockRedis();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never);
  });

  it("returns cached value when available", async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ count: 42 }));

    const result = await getCached("test:key", async () => ({ count: 99 }));

    expect(result).toEqual({ count: 42 });
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("calls fetcher and caches when cache misses", async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");

    const fetcher = vi.fn().mockResolvedValue({ count: 99 });
    const result = await getCached("test:key", fetcher, 300);

    expect(result).toEqual({ count: 99 });
    expect(fetcher).toHaveBeenCalled();
    expect(mockRedis.set).toHaveBeenCalledWith(
      "test:key",
      JSON.stringify({ count: 99 }),
      { ex: 300 },
    );
  });

  it("falls back to fetcher when Redis get fails", async () => {
    mockRedis.get.mockRejectedValue(new Error("Redis down"));
    mockRedis.set.mockResolvedValue("OK");

    const result = await getCached("test:key", async () => ({ fresh: true }));

    expect(result).toEqual({ fresh: true });
  });

  it("returns fresh data even when Redis set fails", async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockRejectedValue(new Error("Redis down"));

    const result = await getCached("test:key", async () => ({ data: "fresh" }));

    expect(result).toEqual({ data: "fresh" });
  });
});

describe("invalidateCache", () => {
  const mockRedis = createMockRedis();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never);
  });

  it("deletes specified keys", async () => {
    mockRedis.del.mockResolvedValue(2);

    await invalidateCache("key1", "key2");

    expect(mockRedis.del).toHaveBeenCalledWith("key1", "key2");
  });

  it("does nothing for empty keys", async () => {
    await invalidateCache();

    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it("silently fails on Redis error", async () => {
    mockRedis.del.mockRejectedValue(new Error("Redis down"));

    await expect(invalidateCache("key1")).resolves.toBeUndefined();
  });
});
