// src/test/jwtBlocklist.test.ts
// ─── Unit tests for JWT blocklist helper ─────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Redis client ─────────────────────────────────────────────────────────
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockGetRedisClient = vi.fn(() => ({ get: mockGet, set: mockSet }));

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: mockGetRedisClient,
}));

// Import AFTER mock is registered
const { blockToken, isTokenBlocked } =
  await import("@/server/lib/jwtBlocklist");

// ─────────────────────────────────────────────────────────────────────────────

describe("blockToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedisClient.mockReturnValue({ get: mockGet, set: mockSet });
  });

  it("stores jti in Redis with correct key and positive TTL", async () => {
    mockSet.mockResolvedValue("OK");
    const jti = "abc-123";
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    await blockToken(jti, expiresAt);

    expect(mockSet).toHaveBeenCalledOnce();
    const [key, value, opts] = mockSet.mock.calls[0] ?? [];
    expect(key).toBe(`jwt:blocklist:${jti}`);
    expect(value).toBe("1");
    expect(opts.ex).toBeGreaterThan(0);
  });

  it("TTL includes 60-second padding", async () => {
    mockSet.mockResolvedValue("OK");
    const jti = "ttl-test";
    const secondsFromNow = 100;
    const expiresAt = Math.floor(Date.now() / 1000) + secondsFromNow;

    await blockToken(jti, expiresAt);

    const callArgs = mockSet.mock.calls[0] ?? [];
    const opts = callArgs[2];
    // TTL should be ~160 (100 remaining + 60 padding), allow ±2s for test timing
    expect(opts.ex).toBeGreaterThanOrEqual(158);
    expect(opts.ex).toBeLessThanOrEqual(162);
  });

  it("does NOT store token if it is already expired (ttl <= 0)", async () => {
    const jti = "already-expired";
    // expired 100s ago — beyond 60s padding so ttl will be negative
    const expiresAt = Math.floor(Date.now() / 1000) - 100;

    await blockToken(jti, expiresAt);

    expect(mockSet).not.toHaveBeenCalled();
  });

  it("silently swallows errors when Redis is unavailable (fail-safe)", async () => {
    mockGetRedisClient.mockImplementationOnce(() => {
      throw new Error("Redis connection refused");
    });

    await expect(
      blockToken("some-jti", Math.floor(Date.now() / 1000) + 3600),
    ).resolves.toBeUndefined();

    expect(mockSet).not.toHaveBeenCalled();
  });

  it("silently swallows errors when Redis set() rejects", async () => {
    mockSet.mockRejectedValueOnce(new Error("set failed"));

    await expect(
      blockToken("jti-set-fail", Math.floor(Date.now() / 1000) + 3600),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("isTokenBlocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedisClient.mockReturnValue({ get: mockGet, set: mockSet });
  });

  it('returns true when Redis has the jti key set to "1"', async () => {
    mockGet.mockResolvedValue("1");

    const result = await isTokenBlocked("blocked-jti");

    expect(result).toBe(true);
    expect(mockGet).toHaveBeenCalledWith("jwt:blocklist:blocked-jti");
  });

  it("returns false when the key is absent (null)", async () => {
    mockGet.mockResolvedValue(null);

    const result = await isTokenBlocked("valid-jti");

    expect(result).toBe(false);
  });

  it("returns false when the key has an unexpected value", async () => {
    mockGet.mockResolvedValue("0");

    const result = await isTokenBlocked("weird-jti");

    expect(result).toBe(false);
  });

  it("returns false (fail-open) when Redis is unavailable", async () => {
    mockGetRedisClient.mockImplementationOnce(() => {
      throw new Error("Redis unavailable");
    });

    const result = await isTokenBlocked("some-jti");

    expect(result).toBe(false);
  });

  it("returns false (fail-open) when Redis get() rejects", async () => {
    mockGet.mockRejectedValueOnce(new Error("get failed"));

    const result = await isTokenBlocked("get-fail-jti");

    expect(result).toBe(false);
  });
});
