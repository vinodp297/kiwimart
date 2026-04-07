// src/test/mobile-auth.test.ts
// ─── Unit tests for mobile JWT auth ──────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";

// Set env var before any module is imported (mobile-auth reads it at call time)
process.env.MOBILE_JWT_SECRET = "test-mobile-jwt-secret-minimum-32-chars-xxxx";

// ── Mock Redis ────────────────────────────────────────────────────────────────
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();
const mockSadd = vi.fn();
const mockSrem = vi.fn();
const mockSmembers = vi.fn();
const mockExpire = vi.fn();

const mockRedis = {
  get: mockGet,
  set: mockSet,
  del: mockDel,
  sadd: mockSadd,
  srem: mockSrem,
  smembers: mockSmembers,
  expire: mockExpire,
};

const mockGetRedisClient = vi.fn(() => mockRedis);

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: mockGetRedisClient,
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
const mockLoggerError = vi.fn();
const mockLoggerInfo = vi.fn();

vi.mock("@/shared/logger", () => ({
  logger: {
    info: mockLoggerInfo,
    error: mockLoggerError,
    warn: vi.fn(),
  },
}));

// Import AFTER mocks are registered
const {
  signMobileToken,
  verifyMobileToken,
  revokeMobileToken,
  revokeAllMobileTokens,
} = await import("@/lib/mobile-auth");

// ── Helper: sign a JWT manually with the test secret ─────────────────────────
async function makeTestToken(
  payload: { sub: string; email: string; role: string; jti: string },
  expiry = "7d",
): Promise<string> {
  const secret = new TextEncoder().encode(process.env.MOBILE_JWT_SECRET);
  return new SignJWT({
    email: payload.email,
    role: payload.role,
    jti: payload.jti,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(secret);
}

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────

describe("signMobileToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedisClient.mockReturnValue(mockRedis);
    mockSet.mockResolvedValue("OK");
    mockSadd.mockResolvedValue(1);
    mockExpire.mockResolvedValue(1);
  });

  it("returns a JWT token and expiresAt", async () => {
    const result = await signMobileToken({
      id: "user-1",
      email: "test@example.com",
      role: "user",
    });

    expect(typeof result.token).toBe("string");
    expect(result.token.split(".")).toHaveLength(3);
    expect(result.expiresAt).toBeDefined();
  });

  it("stores the jti in Redis with 7-day TTL", async () => {
    await signMobileToken({
      id: "user-1",
      email: "test@example.com",
      role: "user",
    });

    expect(mockSet).toHaveBeenCalledOnce();
    const [key, , opts] = mockSet.mock.calls[0]!;
    expect(key).toMatch(/^mobile:token:user-1:/);
    expect(opts.ex).toBe(SEVEN_DAYS_SECONDS);
  });

  it("adds jti to the session set (SADD)", async () => {
    await signMobileToken({
      id: "user-2",
      email: "test2@example.com",
      role: "user",
    });

    expect(mockSadd).toHaveBeenCalledOnce();
    const [setKey, jti] = mockSadd.mock.calls[0]!;
    expect(setKey).toBe("mobile:sessions:user-2");
    // jti should match the one stored in mockSet
    const tokenKey = mockSet.mock.calls[0]![0] as string;
    const storedJti = tokenKey.replace("mobile:token:user-2:", "");
    expect(jti).toBe(storedJti);
  });

  it("sets TTL on the session set (EXPIRE)", async () => {
    await signMobileToken({
      id: "user-3",
      email: "test3@example.com",
      role: "user",
    });

    expect(mockExpire).toHaveBeenCalledOnce();
    const [setKey, ttl] = mockExpire.mock.calls[0]!;
    expect(setKey).toBe("mobile:sessions:user-3");
    // Session set TTL must be longer than token TTL
    expect(ttl).toBeGreaterThan(SEVEN_DAYS_SECONDS);
  });

  it("expiresAt is approximately 7 days from now", async () => {
    const before = Date.now();
    const result = await signMobileToken({
      id: "user-4",
      email: "test4@example.com",
      role: "user",
    });
    const after = Date.now();

    const expiresAtMs = new Date(result.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + SEVEN_DAYS_MS + 1000);
  });

  it("still issues token if Redis is unavailable (sign is non-critical)", async () => {
    mockSet.mockRejectedValueOnce(new Error("Redis down"));

    const result = await signMobileToken({
      id: "user-5",
      email: "test5@example.com",
      role: "user",
    });

    expect(result.token).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("verifyMobileToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedisClient.mockReturnValue(mockRedis);
  });

  it("returns payload for a valid, non-revoked token", async () => {
    const jti = "jti-valid";
    const token = await makeTestToken({
      sub: "user-1",
      email: "test@example.com",
      role: "user",
      jti,
    });
    mockGet.mockResolvedValue(
      JSON.stringify({ issuedAt: new Date().toISOString() }),
    );

    const result = await verifyMobileToken(token);

    expect(result).not.toBeNull();
    expect(result!.sub).toBe("user-1");
    expect(result!.email).toBe("test@example.com");
    expect(result!.jti).toBe(jti);
  });

  it("returns null for a revoked token (Redis key absent)", async () => {
    const jti = "jti-revoked";
    const token = await makeTestToken({
      sub: "user-1",
      email: "test@example.com",
      role: "user",
      jti,
    });
    mockGet.mockResolvedValue(null); // absent = revoked

    const result = await verifyMobileToken(token);

    expect(result).toBeNull();
  });

  it("returns null for an invalid / tampered token", async () => {
    const result = await verifyMobileToken("not.a.valid.token");
    expect(result).toBeNull();
  });

  it("throws AUTH_SERVICE_UNAVAILABLE (503) when Redis is down — fail-closed", async () => {
    const jti = "jti-redis-down";
    const token = await makeTestToken({
      sub: "user-1",
      email: "test@example.com",
      role: "user",
      jti,
    });
    mockGet.mockRejectedValueOnce(new Error("Redis connection refused"));

    await expect(verifyMobileToken(token)).rejects.toMatchObject({
      code: "AUTH_SERVICE_UNAVAILABLE",
      statusCode: 503,
    });
  });

  it("logs mobile.auth.redis_unavailable when Redis is down", async () => {
    const jti = "jti-log-error";
    const token = await makeTestToken({
      sub: "user-1",
      email: "test@example.com",
      role: "user",
      jti,
    });
    mockGet.mockRejectedValueOnce(new Error("Redis down"));

    await expect(verifyMobileToken(token)).rejects.toThrow();

    expect(mockLoggerError).toHaveBeenCalledWith(
      "mobile.auth.redis_unavailable",
      expect.objectContaining({ jti }),
    );
  });

  it("never calls redis.keys — uses O(1) pattern exclusively", async () => {
    const mockKeys = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetRedisClient.mockReturnValue({ ...mockRedis, keys: mockKeys } as any);
    mockGet.mockResolvedValue(
      JSON.stringify({ issuedAt: new Date().toISOString() }),
    );
    const jti = "jti-no-keys";
    const token = await makeTestToken({
      sub: "user-1",
      email: "test@example.com",
      role: "user",
      jti,
    });

    await verifyMobileToken(token);

    expect(mockKeys).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("revokeMobileToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedisClient.mockReturnValue(mockRedis);
    mockDel.mockResolvedValue(1);
    mockSrem.mockResolvedValue(1);
  });

  it("deletes the token key and removes jti from the session set", async () => {
    await revokeMobileToken("user-1", "jti-1");

    expect(mockDel).toHaveBeenCalledWith("mobile:token:user-1:jti-1");
    expect(mockSrem).toHaveBeenCalledWith("mobile:sessions:user-1", "jti-1");
  });

  it("silently swallows errors when Redis is unavailable", async () => {
    mockDel.mockRejectedValueOnce(new Error("Redis down"));

    await expect(
      revokeMobileToken("user-1", "jti-fail"),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("revokeAllMobileTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedisClient.mockReturnValue(mockRedis);
    mockSmembers.mockResolvedValue([]);
    mockDel.mockResolvedValue(0);
  });

  it("uses SMEMBERS to get all jtis — never calls KEYS", async () => {
    const mockKeys = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetRedisClient.mockReturnValue({ ...mockRedis, keys: mockKeys } as any);

    await revokeAllMobileTokens("user-1");

    expect(mockSmembers).toHaveBeenCalledWith("mobile:sessions:user-1");
    expect(mockKeys).not.toHaveBeenCalled();
  });

  it("deletes all token keys when sessions exist", async () => {
    mockSmembers.mockResolvedValue(["jti-a", "jti-b"]);

    await revokeAllMobileTokens("user-1");

    expect(mockDel).toHaveBeenCalledWith(
      "mobile:token:user-1:jti-a",
      "mobile:token:user-1:jti-b",
    );
  });

  it("always deletes the session set key (even when empty)", async () => {
    mockSmembers.mockResolvedValue([]);

    await revokeAllMobileTokens("user-1");

    expect(mockDel).toHaveBeenCalledWith("mobile:sessions:user-1");
  });

  it("deletes token keys before deleting session set (ordering)", async () => {
    mockSmembers.mockResolvedValue(["jti-x"]);
    const callOrder: string[] = [];
    mockDel.mockImplementation(async (...args: string[]) => {
      callOrder.push(args[0]!);
      return 1;
    });

    await revokeAllMobileTokens("user-1");

    expect(callOrder[0]).toBe("mobile:token:user-1:jti-x");
    expect(callOrder[1]).toBe("mobile:sessions:user-1");
  });

  it("silently swallows errors when Redis is unavailable", async () => {
    mockSmembers.mockRejectedValueOnce(new Error("Redis down"));

    await expect(revokeAllMobileTokens("user-fail")).resolves.toBeUndefined();
  });
});
