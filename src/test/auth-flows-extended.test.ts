// src/test/auth-flows-extended.test.ts
// ─── Tests: Auth flows — session management, mobile tokens, password security
// Covers: session version invalidation, mobile token lifecycle, password reset
// token expiry, password strength enforcement.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";

// ── Mock Redis for session store ─────────────────────────────────────────────
const mockRedisGet = vi.fn();
const mockRedisIncr = vi.fn();
const mockRedisExpire = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisSmembers = vi.fn();
const mockRedisSadd = vi.fn();
const mockRedisSrem = vi.fn();

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
    smembers: (...args: unknown[]) => mockRedisSmembers(...args),
    sadd: (...args: unknown[]) => mockRedisSadd(...args),
    srem: (...args: unknown[]) => mockRedisSrem(...args),
    ping: vi.fn().mockResolvedValue("PONG"),
  }),
}));

// ── Mock Turnstile ───────────────────────────────────────────────────────────
vi.mock("@/server/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));

// ── Full mock of user repository for auth tests ─────────────────────────────
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    existsByEmail: vi.fn().mockResolvedValue(false),
    existsByUsername: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({
      id: "user-new",
      email: "new@buyzi.test",
      displayName: "New User",
    }),
    findByEmail: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(undefined),
    deleteAllSessions: vi.fn().mockResolvedValue(undefined),
    findPasswordHash: vi
      .fn()
      .mockResolvedValue({ passwordHash: "$argon2id$existing" }),
    findForEmailVerification: vi.fn().mockResolvedValue(null),
    findEmailVerified: vi.fn().mockResolvedValue({ emailVerified: new Date() }),
    invalidatePendingResetTokens: vi.fn().mockResolvedValue(undefined),
    createResetToken: vi.fn().mockResolvedValue(undefined),
    findResetTokenWithUser: vi.fn().mockResolvedValue(null),
    findManyEmailContactsByIds: vi.fn().mockResolvedValue([]),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const { default: dbClient } = await import("@/lib/db");
        return fn(dbClient);
      }),
  },
}));

// ── Mock mobile-auth jose ────────────────────────────────────────────────────
const mockJwtSign = vi.fn().mockResolvedValue("mock.jwt.token");
const mockJwtVerify = vi.fn();
vi.mock("jose", () => {
  class MockSignJWT {
    setProtectedHeader() {
      return this;
    }
    setIssuedAt() {
      return this;
    }
    setExpirationTime() {
      return this;
    }
    setJti() {
      return this;
    }
    setSubject() {
      return this;
    }
    async sign() {
      return mockJwtSign();
    }
  }
  return {
    SignJWT: MockSignJWT,
    jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
  };
});

// ── Lazy imports ─────────────────────────────────────────────────────────────
const { getSessionVersion, invalidateAllSessions } =
  await import("@/server/lib/sessionStore");
const {
  signMobileToken,
  verifyMobileToken,
  revokeMobileToken,
  revokeAllMobileTokens,
} = await import("@/lib/mobile-auth");
const { AuthService } = await import("@/modules/users/auth.service");
const authService = new AuthService();
const { userRepository } = await import("@/modules/users/user.repository");

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Session management — version-based invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getSessionVersion returns 0 when Redis key does not exist", async () => {
    mockRedisGet.mockResolvedValue(null);

    const version = await getSessionVersion("user-1");

    expect(version).toBe(0);
  });

  it("getSessionVersion returns stored version from Redis", async () => {
    mockRedisGet.mockResolvedValue("5");

    const version = await getSessionVersion("user-1");

    expect(version).toBe(5);
  });

  it("invalidateAllSessions increments version in Redis", async () => {
    mockRedisIncr.mockResolvedValue(6);
    mockRedisExpire.mockResolvedValue(1);

    const newVersion = await invalidateAllSessions("user-1");

    expect(newVersion).toBe(6);
    expect(mockRedisIncr).toHaveBeenCalled();
  });

  it("invalidateAllSessions sets TTL on version key", async () => {
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);

    await invalidateAllSessions("user-1");

    expect(mockRedisExpire).toHaveBeenCalled();
  });

  it("getSessionVersion returns 0 when Redis is unavailable (fail-open)", async () => {
    mockRedisGet.mockRejectedValue(new Error("ECONNREFUSED"));

    const version = await getSessionVersion("user-1");

    expect(version).toBe(0);
  });

  it("invalidateAllSessions returns 0 when Redis is unavailable", async () => {
    mockRedisIncr.mockRejectedValue(new Error("ECONNREFUSED"));

    const version = await invalidateAllSessions("user-1");

    expect(version).toBe(0);
  });
});

describe("Mobile token flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisSet.mockResolvedValue("OK");
    mockRedisSadd.mockResolvedValue(1);
    mockRedisGet.mockResolvedValue("1"); // token exists = not revoked
    mockRedisSmembers.mockResolvedValue([]);
    mockRedisDel.mockResolvedValue(1);
    mockRedisSrem.mockResolvedValue(1);
  });

  it("signMobileToken returns token and expiresAt", async () => {
    const result = await signMobileToken({
      id: "user-1",
      email: "test@buyzi.test",
      role: "user",
    });

    expect(result.token).toBe("mock.jwt.token");
    expect(result.expiresAt).toBeDefined();
    // expiresAt should be in the future
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("signMobileToken stores jti in Redis for revocation tracking", async () => {
    await signMobileToken({
      id: "user-1",
      email: "test@buyzi.test",
      role: "user",
    });

    // Should store the token key in Redis
    expect(mockRedisSet).toHaveBeenCalled();
    // Should add jti to session set
    expect(mockRedisSadd).toHaveBeenCalled();
  });

  it("verifyMobileToken returns payload for valid non-revoked token", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "user-1",
        email: "test@buyzi.test",
        role: "user",
        jti: "jti-123",
      },
    });
    mockRedisGet.mockResolvedValue("1"); // token exists = not revoked

    const result = await verifyMobileToken("mock.jwt.token");

    expect(result).not.toBeNull();
    expect(result!.sub).toBe("user-1");
  });

  it("verifyMobileToken returns null for revoked token", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "user-1",
        email: "test@buyzi.test",
        role: "user",
        jti: "jti-revoked",
      },
    });
    mockRedisGet.mockResolvedValue(null); // token revoked

    const result = await verifyMobileToken("mock.jwt.token");

    expect(result).toBeNull();
  });

  it("verifyMobileToken returns null for invalid JWT", async () => {
    mockJwtVerify.mockRejectedValue(new Error("JWTExpired"));

    const result = await verifyMobileToken("expired.jwt.token");

    expect(result).toBeNull();
  });

  it("revokeMobileToken deletes the specific jti key", async () => {
    await revokeMobileToken("user-1", "jti-to-revoke");

    expect(mockRedisDel).toHaveBeenCalled();
  });

  it("revokeAllMobileTokens fetches all jtis and deletes them", async () => {
    mockRedisSmembers.mockResolvedValue(["jti-1", "jti-2", "jti-3"]);

    await revokeAllMobileTokens("user-1");

    // Should delete each token key
    expect(mockRedisDel).toHaveBeenCalled();
  });

  it("revokeAllMobileTokens handles empty session set gracefully", async () => {
    mockRedisSmembers.mockResolvedValue([]);

    await revokeAllMobileTokens("user-1");

    // No errors thrown
  });
});

describe("AuthService — password reset token lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.order.updateMany).mockResolvedValue({ count: 1 });
  });

  it("requestPasswordReset always returns void (no enumeration)", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);

    // Should not throw even when user does not exist
    await expect(
      authService.requestPasswordReset(
        "nonexistent@test.com",
        "127.0.0.1",
        null,
      ),
    ).resolves.toBeUndefined();
  });

  it("requestPasswordReset creates hashed token when user exists", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "user-1",
      email: "test@buyzi.test",
      displayName: "Test User",
    } as never);

    await authService.requestPasswordReset(
      "test@buyzi.test",
      "127.0.0.1",
      null,
    );

    expect(userRepository.invalidatePendingResetTokens).toHaveBeenCalledWith(
      "user-1",
    );
    expect(userRepository.createResetToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    );
  });

  it("resetPassword rejects expired token", async () => {
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
      usedAt: null,
      user: { id: "user-1", email: "test@test.com", displayName: "Test" },
    } as never);

    await expect(
      authService.resetPassword(
        { token: "a".repeat(64), password: "NewStrongPass123!" },
        "127.0.0.1",
      ),
    ).rejects.toThrow(/Invalid or expired/);
  });

  it("resetPassword rejects already-used token", async () => {
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(), // already used
      user: { id: "user-1", email: "test@test.com", displayName: "Test" },
    } as never);

    await expect(
      authService.resetPassword(
        { token: "a".repeat(64), password: "NewStrongPass123!" },
        "127.0.0.1",
      ),
    ).rejects.toThrow(/Invalid or expired/);
  });

  it("resetPassword rejects non-existent token", async () => {
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue(null);

    await expect(
      authService.resetPassword(
        { token: "a".repeat(64), password: "NewStrongPass123!" },
        "127.0.0.1",
      ),
    ).rejects.toThrow(/Invalid or expired/);
  });

  it("resetPassword rejects weak password", async () => {
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60 * 60_000),
      usedAt: null,
      user: { id: "user-1", email: "test@test.com", displayName: "Test" },
    } as never);

    await expect(
      authService.resetPassword(
        { token: "a".repeat(64), password: "short" },
        "127.0.0.1",
      ),
    ).rejects.toThrow();
  });

  it("successful resetPassword deletes all sessions", async () => {
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60 * 60_000),
      usedAt: null,
      user: { id: "user-1", email: "test@test.com", displayName: "Test" },
    } as never);

    await authService.resetPassword(
      { token: "a".repeat(64), password: "NewStrongPass123!" },
      "127.0.0.1",
    );

    // Session deleteMany called inside transaction
    expect(db.session.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
      }),
    );
  });

  it("successful resetPassword marks token as used", async () => {
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60 * 60_000),
      usedAt: null,
      user: { id: "user-1", email: "test@test.com", displayName: "Test" },
    } as never);

    await authService.resetPassword(
      { token: "a".repeat(64), password: "NewStrongPass123!" },
      "127.0.0.1",
    );

    expect(db.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "token-1" },
        data: { usedAt: expect.any(Date) },
      }),
    );
  });
});

describe("AuthService — register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.existsByEmail).mockResolvedValue(false);
    vi.mocked(userRepository.existsByUsername).mockResolvedValue(false);
    vi.mocked(userRepository.create).mockResolvedValue({
      id: "user-new",
      email: "new@buyzi.test",
      displayName: "New User",
    } as never);
  });

  it("creates user with hashed password", async () => {
    const result = await authService.register(
      {
        email: "new@buyzi.test",
        firstName: "New",
        lastName: "User",
        password: "SecurePass123!",
        hasMarketingConsent: false,
      },
      "127.0.0.1",
    );

    expect(result.userId).toBe("user-new");
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@buyzi.test",
        passwordHash: expect.any(String),
      }),
    );
  });

  it("rejects duplicate email", async () => {
    vi.mocked(userRepository.existsByEmail).mockResolvedValue(true);

    await expect(
      authService.register(
        {
          email: "existing@buyzi.test",
          firstName: "Dup",
          lastName: "User",
          password: "SecurePass123!",
          hasMarketingConsent: false,
        },
        "127.0.0.1",
      ),
    ).rejects.toThrow(/email already exists/i);
  });
});
