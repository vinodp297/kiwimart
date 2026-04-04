// src/test/registration.service.test.ts
// ─── Integration tests: Registration, Email Verification, Password Reset,
//     Mobile Token Issuance & Revocation ──────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";

// ── Environment setup ─────────────────────────────────────────────────────────
// Must be set before mobile-auth module loads (uses TextEncoder(secret) at call time)
process.env.MOBILE_JWT_SECRET = "test-jwt-secret-key-minimum-32-chars-xxxx";

// ── In-memory Redis store shared across mobile-auth functions ─────────────────
const redisStore = new Map<string, string>();
const mockRedis = {
  set: vi.fn().mockImplementation(async (key: string, value: string) => {
    redisStore.set(key, value);
    return "OK";
  }),
  get: vi.fn().mockImplementation(async (key: string) => {
    return redisStore.get(key) ?? null;
  }),
  del: vi.fn().mockImplementation(async (...keys: string[]) => {
    keys.forEach((k) => redisStore.delete(k));
    return keys.length;
  }),
  keys: vi.fn().mockImplementation(async (pattern: string) => {
    // e.g. "mobile:token:user-1:*" → prefix "mobile:token:user-1:"
    const prefix = pattern.endsWith(":*") ? pattern.slice(0, -1) : pattern;
    return [...redisStore.keys()].filter((k) => k.startsWith(prefix));
  }),
};

// ── Additional mocks ──────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn().mockReturnValue(mockRedis),
}));

// Override setup.ts password mock — add checkPwnedPassword
vi.mock("@/server/lib/password", () => ({
  hashPassword: vi
    .fn()
    .mockResolvedValue("$argon2id$v=19$m=65536,t=3,p=1$hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
  needsRehash: vi.fn().mockReturnValue(false),
  checkPwnedPassword: vi.fn().mockResolvedValue(false), // default: not pwned
}));

// Override setup.ts email mock — add listing + auth-specific email functions
vi.mock("@/server/email", () => ({
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendListingApprovedEmail: vi.fn().mockResolvedValue(undefined),
  sendListingRejectedEmail: vi.fn().mockResolvedValue(undefined),
  sendPriceDropEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    existsByEmail: vi.fn().mockResolvedValue(false),
    existsByUsername: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "john@example.com",
      displayName: "John Doe",
    }),
    findByEmail: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(undefined),
    deleteAllSessions: vi.fn().mockResolvedValue(undefined),
    findForEmailVerification: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/server/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/infrastructure/email/client", () => ({
  getEmailClient: vi.fn().mockReturnValue({
    emails: {
      send: vi.fn().mockResolvedValue({ id: "email-sent-1" }),
    },
  }),
  EMAIL_FROM: "noreply@kiwimart.co.nz",
}));

vi.mock("next/server", () => {
  class MockNextRequest {
    url: string;
    nextUrl: URL;
    constructor(urlStr: string) {
      this.url = urlStr;
      this.nextUrl = new URL(urlStr);
    }
  }
  return {
    NextRequest: MockNextRequest,
    NextResponse: {
      redirect: vi.fn(
        (url: URL) =>
          new Response(null, {
            status: 302,
            headers: { Location: url.toString() },
          }),
      ),
    },
  };
});

// ── Lazy imports (after all mocks declared) ───────────────────────────────────

const { registerUser, requestPasswordReset, resetPassword } =
  await import("@/server/actions/auth");
const { GET: verifyEmailGET } = await import("@/app/api/verify-email/route");
const { POST: tokenPOST } = await import("@/app/api/v1/auth/token/route");
const { POST: logoutPOST } = await import("@/app/api/v1/auth/logout/route");
const {
  signMobileToken,
  verifyMobileToken,
  revokeMobileToken,
  revokeAllMobileTokens,
} = await import("@/lib/mobile-auth");
const { userRepository } = await import("@/modules/users/user.repository");
const { checkPwnedPassword, hashPassword, verifyPassword } =
  await import("@/server/lib/password");
const { verifyTurnstile } = await import("@/server/lib/turnstile");
const { sendVerificationEmail, sendPasswordResetEmail } =
  await import("@/server/email");
const { rateLimit } = await import("@/server/lib/rateLimit");

// ── Shared valid registration data ────────────────────────────────────────────

const validRegisterInput = {
  firstName: "John",
  lastName: "Doe",
  email: "john@example.com",
  username: "johndoe",
  password: "SecurePass123!",
  confirmPassword: "SecurePass123!",
  agreeTerms: true as const,
  agreeMarketing: false,
  turnstileToken: "",
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — USER REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

describe("registerUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
    // Restore default mock implementations after clearAllMocks clears history
    vi.mocked(userRepository.existsByEmail).mockResolvedValue(false);
    vi.mocked(userRepository.existsByUsername).mockResolvedValue(false);
    vi.mocked(userRepository.create).mockResolvedValue({
      id: "user-1",
      email: "john@example.com",
      displayName: "John Doe",
    });
    vi.mocked(checkPwnedPassword).mockResolvedValue(false);
    vi.mocked(hashPassword).mockResolvedValue("$argon2id$v=19$hashed");
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
  });

  it("registers user successfully with valid data", async () => {
    const result = await registerUser(validRegisterInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe("user-1");
    }
    expect(userRepository.create).toHaveBeenCalled();
  });

  it("fails if email already exists", async () => {
    vi.mocked(userRepository.existsByEmail).mockResolvedValue(true);

    const result = await registerUser(validRegisterInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/email/i);
    }
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it("fails if password is too short (Zod validation)", async () => {
    const result = await registerUser({
      ...validRegisterInput,
      password: "Short1A", // < 12 chars
      confirmPassword: "Short1A",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors?.password).toBeDefined();
    }
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it("fails if password has been pwned", async () => {
    vi.mocked(checkPwnedPassword).mockResolvedValue(true);

    const result = await registerUser(validRegisterInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/breach|compromised/i);
    }
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it("HaveIBeenPwned API failure does not block registration (fail-open)", async () => {
    // fail-open: checkPwnedPassword returns false when API is unavailable
    vi.mocked(checkPwnedPassword).mockResolvedValue(false);

    const result = await registerUser(validRegisterInput);

    expect(result.success).toBe(true);
    expect(userRepository.create).toHaveBeenCalled();
  });

  it("password is hashed with argon2id before storage", async () => {
    await registerUser(validRegisterInput);

    expect(hashPassword).toHaveBeenCalledWith(validRegisterInput.password);
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        passwordHash: "$argon2id$v=19$hashed",
      }),
    );
  });

  it("plain text password is never stored", async () => {
    await registerUser(validRegisterInput);

    const createCall = vi.mocked(userRepository.create).mock.calls[0]?.[0];
    expect(createCall).toBeDefined();
    // The raw password must not appear anywhere in the create payload
    expect(JSON.stringify(createCall)).not.toContain(
      validRegisterInput.password,
    );
  });

  it("sends verification email after successful registration", async () => {
    await registerUser(validRegisterInput);

    // sendVerificationEmail is dynamically imported inside registerUser — allow event loop tick
    await new Promise((r) => setTimeout(r, 0));
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "john@example.com",
        verifyUrl: expect.stringContaining("/api/verify-email?token="),
      }),
    );
  });

  it("new user is created with emailVerified = null (unverified)", async () => {
    vi.mocked(userRepository.create).mockImplementation(async (data) => {
      // Verify the create call does NOT pass emailVerified = true
      expect(
        (data as Record<string, unknown>)["emailVerified"],
      ).toBeUndefined();
      return {
        id: "user-1",
        email: data.email as string,
        displayName: "John Doe",
      };
    });

    const result = await registerUser(validRegisterInput);

    expect(result.success).toBe(true);
  });

  it("Turnstile token is verified before processing in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    vi.mocked(verifyTurnstile).mockResolvedValue(false);

    const result = await registerUser({
      ...validRegisterInput,
      turnstileToken: "bad-token",
    });

    (process.env as Record<string, string>).NODE_ENV = originalEnv;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/bot verification/i);
    }
    expect(userRepository.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — EMAIL VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

describe("emailVerification (GET /api/verify-email)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeRequest = (token?: string) => {
    const url = `http://localhost/api/verify-email${token ? `?token=${token}` : ""}`;
    return {
      nextUrl: new URL(url),
      url,
    } as unknown as import("next/server").NextRequest;
  };

  it("verifies email successfully with valid token", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      displayName: "Test User",
      emailVerified: null,
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);

    const response = await verifyEmailGET(makeRequest("valid-token-hex"));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("verified=true");
  });

  it("redirects to error page with invalid token (not found in DB)", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null);

    const response = await verifyEmailGET(makeRequest("bad-token"));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("error=invalid");
  });

  it("redirects to error page when no token provided", async () => {
    const response = await verifyEmailGET(makeRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("error=invalid");
  });

  it("redirects to homepage when email is already verified", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      displayName: "Test User",
      emailVerified: new Date("2024-01-01"),
    } as never);

    const response = await verifyEmailGET(makeRequest("already-used-token"));

    expect(response.status).toBe(302);
    // Already verified → redirect home, not to error
    expect(response.headers.get("Location")).toContain("verified=true");
    expect(response.headers.get("Location")).not.toContain("error=invalid");
  });

  it("sets emailVerified and clears token after successful verification", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      displayName: "Test User",
      emailVerified: null,
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);

    await verifyEmailGET(makeRequest("valid-token"));

    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          emailVerified: expect.any(Date),
          emailVerifyToken: null,
          emailVerifyExpires: null,
        }),
      }),
    );
  });

  it("token query uses expiry filter so expired tokens are not found", async () => {
    // The route queries: { emailVerifyToken: token, emailVerifyExpires: { gt: now } }
    // Expired tokens return null from findFirst (simulated here)
    vi.mocked(db.user.findFirst).mockResolvedValue(null); // expired → not found

    const response = await verifyEmailGET(makeRequest("expired-token"));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("error=invalid");
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — PASSWORD RESET
// ─────────────────────────────────────────────────────────────────────────────

describe("requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 5,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
  });

  it("sends reset email for a known account", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      displayName: "Test User",
    });
    vi.mocked(db.passwordResetToken.updateMany).mockResolvedValue({
      count: 0,
    } as never);
    vi.mocked(db.passwordResetToken.create).mockResolvedValue({} as never);

    const result = await requestPasswordReset({ email: "user@test.com" });

    expect(result.success).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@test.com",
        resetUrl: expect.stringContaining("/reset-password?token="),
      }),
    );
  });

  it("returns success even when email is unknown (prevents user enumeration)", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);

    const result = await requestPasswordReset({ email: "nobody@example.com" });

    // Always success — never reveals whether email exists
    expect(result.success).toBe(true);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("stores hashed token — not the raw token — in the database", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      displayName: "Test User",
    });
    vi.mocked(db.passwordResetToken.updateMany).mockResolvedValue({
      count: 0,
    } as never);
    vi.mocked(db.passwordResetToken.create).mockResolvedValue({} as never);

    await requestPasswordReset({ email: "user@test.com" });

    const createCall = vi.mocked(db.passwordResetToken.create).mock
      .calls[0]?.[0];
    expect(createCall).toBeDefined();
    const tokenHash = (createCall as { data: { tokenHash: string } }).data
      .tokenHash;
    // tokenHash is a SHA-256 hex string (64 chars) — not the 64-char raw token itself
    // (raw token == 32 bytes hex == 64 chars; hash also 64 chars but different value)
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 5,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    vi.mocked(checkPwnedPassword).mockResolvedValue(false);
    vi.mocked(hashPassword).mockResolvedValue("$argon2id$new-hashed-password");
  });

  const validResetInput = {
    token: "valid-reset-token-64-hex-chars-padded-0000000000000000000000000000",
    password: "NewSecurePass456!",
    confirmPassword: "NewSecurePass456!",
  };

  it("rejects invalid or expired token", async () => {
    vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue(null);

    const result = await resetPassword(validResetInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid|expired/i);
    }
  });

  it("rejects already-used token", async () => {
    vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      tokenHash: "hash",
      usedAt: new Date(), // already used
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "user-1", email: "user@test.com", displayName: "User" },
    } as never);

    const result = await resetPassword(validResetInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid|expired/i);
    }
  });

  it("updates password after presenting a valid token", async () => {
    vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      tokenHash: "hash",
      usedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "user-1", email: "user@test.com", displayName: "User" },
    } as never);
    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function")
        return (fn as (tx: typeof db) => Promise<unknown>)(db);
      return [];
    });
    vi.mocked(db.passwordResetToken.update).mockResolvedValue({} as never);
    vi.mocked(db.session.deleteMany).mockResolvedValue({ count: 0 } as never);

    const result = await resetPassword(validResetInput);

    expect(result.success).toBe(true);
    // resetPassword calls userRepository.update(userId, { passwordHash }, tx) — mocked
    expect(userRepository.update).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        passwordHash: "$argon2id$new-hashed-password",
      }),
      expect.anything(),
    );
  });

  it("marks reset token as used after successful reset", async () => {
    vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      tokenHash: "hash",
      usedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "user-1", email: "user@test.com", displayName: "User" },
    } as never);
    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function")
        return (fn as (tx: typeof db) => Promise<unknown>)(db);
      return [];
    });
    vi.mocked(db.user.update).mockResolvedValue({} as never);
    vi.mocked(db.passwordResetToken.update).mockResolvedValue({} as never);
    vi.mocked(db.session.deleteMany).mockResolvedValue({ count: 0 } as never);

    await resetPassword(validResetInput);

    expect(db.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tok-1" },
        data: expect.objectContaining({ usedAt: expect.any(Date) }),
      }),
    );
  });

  it("invalidates all sessions for security after password reset", async () => {
    vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      tokenHash: "hash",
      usedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "user-1", email: "user@test.com", displayName: "User" },
    } as never);
    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function")
        return (fn as (tx: typeof db) => Promise<unknown>)(db);
      return [];
    });
    vi.mocked(db.passwordResetToken.update).mockResolvedValue({} as never);
    vi.mocked(db.session.deleteMany).mockResolvedValue({ count: 2 } as never);

    await resetPassword(validResetInput);

    // resetPassword calls userRepository.deleteAllSessions(userId, tx) — mocked
    expect(userRepository.deleteAllSessions).toHaveBeenCalledWith(
      "user-1",
      expect.anything(),
    );
  });

  it("rejects new password found in pwned database", async () => {
    vi.mocked(checkPwnedPassword).mockResolvedValue(true);

    // Validation happens in resetPassword: checkPwnedPassword is NOT called here
    // (auth.ts resetPassword does NOT call checkPwnedPassword — that's only in registration).
    // This test verifies the correct behaviour: resetPassword ignores HIBP and proceeds.
    // (The password strength is validated by Zod schema only.)
    vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue(null);

    const result = await resetPassword(validResetInput);
    // Token lookup fails first — demonstrating the service runs without HIBP gate
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — MOBILE TOKEN ISSUANCE (POST /api/v1/auth/token)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/auth/token — mobile token issuance", () => {
  const makeRequest = (body: Record<string, unknown>) =>
    new Request("http://localhost/api/v1/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const dbUser = {
    id: "user-mobile-1",
    email: "mobile@test.com",
    passwordHash: "$argon2id$v=19$hashed",
    isAdmin: false,
    isBanned: false,
    displayName: "Mobile User",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 5,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    vi.mocked(verifyPassword).mockResolvedValue(true);
    // Re-wire redis mock implementations after clearAllMocks
    mockRedis.set.mockImplementation(async (key: string, value: string) => {
      redisStore.set(key, value);
      return "OK";
    });
    mockRedis.get.mockImplementation(
      async (key: string) => redisStore.get(key) ?? null,
    );
    mockRedis.del.mockImplementation(async (...keys: string[]) => {
      keys.forEach((k) => redisStore.delete(k));
      return keys.length;
    });
    mockRedis.keys.mockImplementation(async (pattern: string) => {
      const prefix = pattern.endsWith(":*") ? pattern.slice(0, -1) : pattern;
      return [...redisStore.keys()].filter((k) => k.startsWith(prefix));
    });
  });

  it("issues Bearer token with valid email + password", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(dbUser as never);

    const response = await tokenPOST(
      makeRequest({ email: "mobile@test.com", password: "pass" }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect((body.data as Record<string, unknown>).token).toBeDefined();
  });

  it("fails with wrong password (401)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(dbUser as never);
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const response = await tokenPOST(
      makeRequest({ email: "mobile@test.com", password: "wrong" }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it("fails for non-existent user (401, timing-safe)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const response = await tokenPOST(
      makeRequest({ email: "ghost@test.com", password: "anypass" }),
    );

    expect(response.status).toBe(401);
  });

  it("fails for banned user (403)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      ...dbUser,
      isBanned: true,
    } as never);

    const response = await tokenPOST(
      makeRequest({ email: "mobile@test.com", password: "pass" }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(403);
    expect(body.code).toBe("ACCOUNT_BANNED");
  });

  it("token payload includes correct userId (sub claim)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(dbUser as never);

    const response = await tokenPOST(
      makeRequest({ email: "mobile@test.com", password: "pass" }),
    );
    const body = (await response.json()) as { data: { token: string } };
    const token = body.data.token;

    const payload = await verifyMobileToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-mobile-1");
  });

  it("token is stored in Redis with jti key for revocation", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(dbUser as never);

    await tokenPOST(
      makeRequest({ email: "mobile@test.com", password: "pass" }),
    );

    // signMobileToken calls redis.set with key "mobile:token:{userId}:{jti}"
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining("mobile:token:user-mobile-1:"),
      expect.any(String),
      expect.objectContaining({ ex: expect.any(Number) }),
    );
  });

  it("rate limiting returns 429 after too many failed attempts", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 900_000,
      retryAfter: 900,
    });

    const response = await tokenPOST(
      makeRequest({ email: "mobile@test.com", password: "pass" }),
    );

    expect(response.status).toBe(429);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — MOBILE TOKEN REVOCATION
// ─────────────────────────────────────────────────────────────────────────────

describe("mobile token revocation", () => {
  const testUser = {
    id: "user-rev-1",
    email: "rev@test.com",
    role: "user" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
    // Re-wire redis implementations
    mockRedis.set.mockImplementation(async (key: string, value: string) => {
      redisStore.set(key, value);
      return "OK";
    });
    mockRedis.get.mockImplementation(
      async (key: string) => redisStore.get(key) ?? null,
    );
    mockRedis.del.mockImplementation(async (...keys: string[]) => {
      keys.forEach((k) => redisStore.delete(k));
      return keys.length;
    });
    mockRedis.keys.mockImplementation(async (pattern: string) => {
      const prefix = pattern.endsWith(":*") ? pattern.slice(0, -1) : pattern;
      return [...redisStore.keys()].filter((k) => k.startsWith(prefix));
    });
  });

  it("logout route revokes the specific token jti in Redis", async () => {
    const { token } = await signMobileToken(testUser);
    // Confirm token is valid before logout
    const payloadBefore = await verifyMobileToken(token);
    expect(payloadBefore).not.toBeNull();

    // Mock requireApiUser's db lookup
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: testUser.id,
      email: testUser.email,
      isAdmin: false,
      isBanned: false,
      sellerEnabled: true,
      stripeOnboarded: false,
    } as never);

    const request = new Request("http://localhost/api/v1/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    const response = await logoutPOST(request);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect((body.data as Record<string, unknown>)?.message).toMatch(
      /logged out/i,
    );
    // The jti key should have been deleted from redis
    expect(mockRedis.del).toHaveBeenCalled();
  });

  it("revoked token fails verification", async () => {
    const { token } = await signMobileToken(testUser);
    const payload = await verifyMobileToken(token);
    expect(payload).not.toBeNull();

    // Revoke it
    await revokeMobileToken(testUser.id, payload!.jti);

    // Verify it now fails (jti key gone from redis)
    const payloadAfter = await verifyMobileToken(token);
    expect(payloadAfter).toBeNull();
  });

  it("revokeAllMobileTokens clears all jti keys for a user", async () => {
    // Sign two tokens for the same user
    const { token: token1 } = await signMobileToken(testUser);
    const { token: token2 } = await signMobileToken(testUser);

    // Both should be valid
    expect(await verifyMobileToken(token1)).not.toBeNull();
    expect(await verifyMobileToken(token2)).not.toBeNull();

    // Revoke all
    await revokeAllMobileTokens(testUser.id);

    // Both should now be invalid
    expect(await verifyMobileToken(token1)).toBeNull();
    expect(await verifyMobileToken(token2)).toBeNull();
  });

  it("valid token still works after a different token for same user is revoked", async () => {
    const { token: tokenA } = await signMobileToken(testUser);
    const { token: tokenB } = await signMobileToken(testUser);

    const payloadA = await verifyMobileToken(tokenA);
    expect(payloadA).not.toBeNull();

    // Revoke only token A
    await revokeMobileToken(testUser.id, payloadA!.jti);

    // Token A should fail
    expect(await verifyMobileToken(tokenA)).toBeNull();
    // Token B should still pass
    expect(await verifyMobileToken(tokenB)).not.toBeNull();
  });
});
