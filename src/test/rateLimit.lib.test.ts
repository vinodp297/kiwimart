// src/test/rateLimit.lib.test.ts
// ─── Tests: Rate Limiter (Upstash) — actual implementation ──────────────────
// Covers rateLimit(): development bypass, success/failure pass-through, fail-
// open vs fail-closed error handling, and getClientIp() header precedence.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Opt out of the global rateLimit mock from setup.ts — we're testing the real thing.
vi.unmock("@/server/lib/rateLimit");

vi.mock("server-only", () => ({}));

// ── Mock Upstash Ratelimit — class with .limit() ─────────────────────────────
const { mockLimit } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class MockRatelimit {
    constructor(_opts: unknown) {}
    limit = mockLimit;
    static slidingWindow = () => "sliding-window-mock";
  },
}));

// ── Mock Redis client ────────────────────────────────────────────────────────
vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn().mockReturnValue({}),
}));

// ── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("@/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Intentionally DO NOT import "./setup" — that would globally mock the
// rateLimit module we're trying to test.

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { rateLimit, getClientIp } = await import("@/server/lib/rateLimit");

// ── Preserve / restore original envs touched in tests ────────────────────────
const originalEnv = process.env.NODE_ENV;
const originalRedisUrl = process.env.UPSTASH_REDIS_REST_URL;

// ─────────────────────────────────────────────────────────────────────────────
// rateLimit
// ─────────────────────────────────────────────────────────────────────────────

describe("rateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Force "production-like" path so the dev bypass is not taken.
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.com";
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    (process.env as Record<string, string | undefined>).UPSTASH_REDIS_REST_URL =
      originalRedisUrl;
  });

  it("dev without Redis configured → bypass returns success:true", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV =
      "development";
    process.env.UPSTASH_REDIS_REST_URL = "";

    const result = await rateLimit("auth", "127.0.0.1");

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(999);
    expect(mockLimit).not.toHaveBeenCalled();
  });

  it("dev with placeholder Redis URL → bypass returns success:true", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV =
      "development";
    process.env.UPSTASH_REDIS_REST_URL = "https://placeholder.upstash.io";

    const result = await rateLimit("auth", "127.0.0.1");

    expect(result.success).toBe(true);
    expect(mockLimit).not.toHaveBeenCalled();
  });

  it("success path → returns limiter result with derived retryAfter", async () => {
    const resetMs = Date.now() + 30_000;
    mockLimit.mockResolvedValueOnce({
      success: true,
      remaining: 4,
      reset: resetMs,
    });

    const result = await rateLimit("auth", "203.0.113.5");

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.reset).toBe(resetMs);
    // retryAfter ≈ 30s
    expect(result.retryAfter).toBeGreaterThanOrEqual(29);
    expect(result.retryAfter).toBeLessThanOrEqual(31);
  });

  it("limit exceeded → returns success:false", async () => {
    mockLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
    });

    const result = await rateLimit("auth", "identifier");

    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("passes identifier through to limiter.limit", async () => {
    mockLimit.mockResolvedValueOnce({
      success: true,
      remaining: 10,
      reset: Date.now() + 60_000,
    });

    await rateLimit("message", "user_abc");

    expect(mockLimit).toHaveBeenCalledWith("user_abc");
  });

  it("Redis error on fail-closed key (auth) → throws", async () => {
    mockLimit.mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(rateLimit("auth", "id")).rejects.toThrow("Redis unavailable");
  });

  it("Redis error on publicRead → fail-open returns success:true", async () => {
    mockLimit.mockRejectedValueOnce(new Error("Redis down"));

    const result = await rateLimit("publicRead", "127.0.0.1");

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(-1);
  });

  it("Redis error on publicSearch → fail-open", async () => {
    mockLimit.mockRejectedValueOnce(new Error("Network reset"));

    const result = await rateLimit("publicSearch", "127.0.0.1");

    expect(result.success).toBe(true);
  });

  it("Redis error on clientErrors → fail-open (error reporting never blocked)", async () => {
    mockLimit.mockRejectedValueOnce(new Error("Redis timeout"));

    const result = await rateLimit("clientErrors", "127.0.0.1");

    expect(result.success).toBe(true);
  });

  it("supports admin-keyed limiters (adminBan)", async () => {
    mockLimit.mockResolvedValueOnce({
      success: true,
      remaining: 9,
      reset: Date.now() + 60_000,
    });

    const result = await rateLimit("adminBan", "admin-1");

    expect(result.success).toBe(true);
    expect(mockLimit).toHaveBeenCalledWith("admin-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getClientIp
// ─────────────────────────────────────────────────────────────────────────────

describe("getClientIp", () => {
  it("prefers x-real-ip when present (Vercel infra)", () => {
    const headers = new Headers({
      "x-real-ip": "203.0.113.5",
      "cf-connecting-ip": "198.51.100.1",
      "x-vercel-forwarded-for": "192.0.2.9, 10.0.0.1",
    });

    expect(getClientIp(headers)).toBe("203.0.113.5");
  });

  it("falls back to cf-connecting-ip when x-real-ip missing", () => {
    const headers = new Headers({
      "cf-connecting-ip": "198.51.100.1",
      "x-vercel-forwarded-for": "192.0.2.9",
    });

    expect(getClientIp(headers)).toBe("198.51.100.1");
  });

  it("falls back to first value of x-vercel-forwarded-for", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "192.0.2.9, 10.0.0.1",
    });

    expect(getClientIp(headers)).toBe("192.0.2.9");
  });

  it("returns unique unknown-{uuid} when no IP header present", () => {
    const headers = new Headers({ "user-agent": "TestAgent/1.0" });

    const ip = getClientIp(headers);

    expect(ip).toMatch(/^unknown-[0-9a-f-]{36}$/);
  });

  it("each IP-less request returns a distinct fallback id (no shared bucket)", () => {
    const headers = new Headers();

    const a = getClientIp(headers);
    const b = getClientIp(headers);

    expect(a).not.toBe(b);
  });

  it("ignores x-forwarded-for (spoofable) and falls through to fallback", () => {
    const headers = new Headers({
      "x-forwarded-for": "evil-spoofed-ip",
    });

    const ip = getClientIp(headers);

    // Must NOT return the spoofed value
    expect(ip).not.toBe("evil-spoofed-ip");
    expect(ip).toMatch(/^unknown-/);
  });
});
