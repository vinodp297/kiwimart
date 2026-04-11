// src/test/auth-actions.test.ts
// ─── Tests: Auth Server Actions ─────────────────────────────────────────────
// Covers:
//   registerUser — validation, breach check, rate limit, email uniqueness
//   requestPasswordReset — rate limit, user enumeration prevention
//   resetPassword — token validation, expiry, session invalidation
//   changePassword — current password verification, breach check, session invalidation

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";
import db from "@/lib/db";

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: mockRequireUser,
}));

// ── Override password mock to include isPasswordBreached ───────────────────────
const mockHashPassword = vi.fn().mockResolvedValue("$argon2id$v=19$hashed-new");
const mockVerifyPassword = vi.fn().mockResolvedValue(true);
const mockIsPasswordBreached = vi.fn().mockResolvedValue(false);
vi.mock("@/server/lib/password", () => ({
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
  isPasswordBreached: (...args: unknown[]) => mockIsPasswordBreached(...args),
}));

// ── Override email mock to include auth-specific functions ─────────────────────
const mockSendVerificationEmail = vi.fn().mockResolvedValue(undefined);
const mockSendPasswordResetEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/email", () => ({
  sendOrderDispatchedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendOfferResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: (...args: unknown[]) =>
    mockSendVerificationEmail(...args),
  sendPasswordResetEmail: (...args: unknown[]) =>
    mockSendPasswordResetEmail(...args),
}));

// ── Mock turnstile ────────────────────────────────────────────────────────────
vi.mock("@/server/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));

// ── Mock user repository with all needed methods ──────────────────────────────
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
    findPasswordHash: vi.fn().mockResolvedValue({
      passwordHash: "$argon2id$existing",
    }),
    findForEmailVerification: vi.fn().mockResolvedValue(null),
    findEmailVerified: vi.fn().mockResolvedValue({ emailVerified: new Date() }),
    invalidatePendingResetTokens: vi.fn().mockResolvedValue(undefined),
    createResetToken: vi.fn().mockResolvedValue(undefined),
    findResetTokenWithUser: vi.fn().mockResolvedValue(null),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { registerUser, requestPasswordReset, resetPassword } =
  await import("@/server/actions/auth");
const { changePassword } = await import("@/server/actions/account");
const { userRepository } = await import("@/modules/users/user.repository");
const { rateLimit } = await import("@/server/lib/rateLimit");
// enqueueEmail is mocked globally by setup.ts; import for assertion
const { enqueueEmail } = await import("@/lib/email-queue");

// ── Helpers ───────────────────────────────────────────────────────────────────

const validRegisterInput = {
  firstName: "John",
  lastName: "Doe",
  email: "john@example.com",
  username: "johndoe",
  password: "SecurePass123!",
  confirmPassword: "SecurePass123!",
  agreeTerms: true as const,
  hasMarketingConsent: false,
  turnstileToken: "",
};

const TEST_USER = {
  id: "user-auth-test",
  email: "user@buyzi.test",
  isAdmin: false,
  isSellerEnabled: false,
  isStripeOnboarded: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("registerUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.existsByEmail).mockResolvedValue(false);
    vi.mocked(userRepository.existsByUsername).mockResolvedValue(false);
    vi.mocked(userRepository.create).mockResolvedValue({
      id: "user-1",
      email: "john@example.com",
      displayName: "John Doe",
    });
    mockIsPasswordBreached.mockResolvedValue(false);
    mockHashPassword.mockResolvedValue("$argon2id$v=19$hashed");
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

  it("normalises email to lowercase", async () => {
    await registerUser({
      ...validRegisterInput,
      email: "John@Example.COM",
    });
    expect(userRepository.existsByEmail).toHaveBeenCalledWith(
      "john@example.com",
    );
  });

  it("rejects if email already exists", async () => {
    vi.mocked(userRepository.existsByEmail).mockResolvedValue(true);
    const result = await registerUser(validRegisterInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/email/i);
    }
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it("rejects if password too short (Zod validation)", async () => {
    const result = await registerUser({
      ...validRegisterInput,
      password: "Short1!",
      confirmPassword: "Short1!",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors?.password).toBeDefined();
    }
  });

  it("rejects if password confirmation does not match", async () => {
    const result = await registerUser({
      ...validRegisterInput,
      confirmPassword: "DifferentPass123!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects if password has been breached", async () => {
    mockIsPasswordBreached.mockResolvedValue(true);
    const result = await registerUser(validRegisterInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/breach|compromised/i);
    }
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it("breach check failure does not block registration (fail-open)", async () => {
    // isPasswordBreached returns false on API failure (fail-open)
    mockIsPasswordBreached.mockResolvedValue(false);
    const result = await registerUser(validRegisterInput);
    expect(result.success).toBe(true);
    expect(userRepository.create).toHaveBeenCalled();
  });

  it("rate limits registration attempts", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 3600,
    });
    const result = await registerUser(validRegisterInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many|try again/i);
    }
  });

  it("sends verification email after successful registration", async () => {
    await registerUser(validRegisterInput);
    // enqueueEmail is awaited inside the action so no setTimeout needed
    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "verification",
        to: "john@example.com",
        verifyUrl: expect.stringContaining("verify-email?token="),
      }),
    );
  });

  // ── Username TOCTOU fix: retry-on-P2002 ────────────────────────────────────

  /** Helper: builds a Prisma P2002 error for the username unique constraint. */
  function usernameP2002() {
    return Object.assign(new Error("Unique constraint violated"), {
      code: "P2002",
      meta: { target: ["username"] },
    });
  }

  it("retries with UUID suffix when first create throws P2002 on username", async () => {
    const successUser = {
      id: "user-retry",
      email: "john@example.com",
      username: "johndoe-retried",
      displayName: "John Doe",
    };
    vi.mocked(userRepository.create)
      .mockRejectedValueOnce(usernameP2002())
      .mockResolvedValueOnce(successUser as never);

    const result = await registerUser(validRegisterInput);
    expect(result.success).toBe(true);
    expect(userRepository.create).toHaveBeenCalledTimes(2);
    // Second call must use a different username (base + UUID suffix)
    const secondCall = vi.mocked(userRepository.create).mock.calls[1]![0] as {
      username: string;
    };
    expect(secondCall.username).toMatch(/^johndoe[0-9a-f-]{8,}$/);
  });

  it("throws after 5 consecutive P2002 username collisions", async () => {
    vi.mocked(userRepository.create).mockRejectedValue(usernameP2002());

    // After 5 attempts all fail → error propagates out of the action
    await expect(registerUser(validRegisterInput)).rejects.toThrow(
      "Unique constraint violated",
    );
    expect(userRepository.create).toHaveBeenCalledTimes(5);
  });

  it("rethrows P2002 on non-username field without retrying", async () => {
    const emailP2002 = Object.assign(new Error("Unique constraint on email"), {
      code: "P2002",
      meta: { target: ["email"] },
    });
    vi.mocked(userRepository.create).mockRejectedValue(emailP2002);

    // Not a username collision → thrown immediately without retrying
    await expect(registerUser(validRegisterInput)).rejects.toThrow(
      "Unique constraint on email",
    );
    expect(userRepository.create).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-P2002 errors without retrying", async () => {
    vi.mocked(userRepository.create).mockRejectedValue(
      new Error("DB connection lost"),
    );

    await expect(registerUser(validRegisterInput)).rejects.toThrow(
      "DB connection lost",
    );
    expect(userRepository.create).toHaveBeenCalledTimes(1);
  });

  it("rejects missing required fields", async () => {
    const result = await registerUser({
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      agreeTerms: true,
      hasMarketingConsent: false,
      turnstileToken: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
  });

  it("always returns success to prevent user enumeration", async () => {
    // User does NOT exist
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    const result = await requestPasswordReset({
      email: "nonexistent@example.com",
      turnstileToken: "",
    });
    expect(result.success).toBe(true);
    // No token created for non-existent user
    expect(userRepository.createResetToken).not.toHaveBeenCalled();
  });

  it("creates reset token when user exists", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      displayName: "Test User",
    } as never);

    const result = await requestPasswordReset({
      email: "user@example.com",
      turnstileToken: "",
    });

    expect(result.success).toBe(true);
    expect(userRepository.invalidatePendingResetTokens).toHaveBeenCalledWith(
      "user-1",
    );
    expect(userRepository.createResetToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        tokenHash: expect.any(String),
      }),
    );
  });

  it("sends reset email when user exists", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      displayName: "Test User",
    } as never);

    await requestPasswordReset({
      email: "user@example.com",
      turnstileToken: "",
    });

    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "passwordReset",
        to: "user@example.com",
        resetUrl: expect.stringContaining("reset-password?token="),
        expiresInMinutes: 60,
      }),
    );
  });

  it("rate limits password reset attempts", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 900,
    });
    const result = await requestPasswordReset({
      email: "user@example.com",
      turnstileToken: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many|try again/i);
    }
  });

  it("rejects invalid email format", async () => {
    const result = await requestPasswordReset({
      email: "not-an-email",
      turnstileToken: "",
    });
    expect(result.success).toBe(false);
  });

  it("invalidates existing tokens before creating new one", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      displayName: "Test User",
    } as never);

    await requestPasswordReset({
      email: "user@example.com",
      turnstileToken: "",
    });

    // invalidatePendingResetTokens called before createResetToken — invalidates old tokens
    expect(userRepository.invalidatePendingResetTokens).toHaveBeenCalledWith(
      "user-1",
    );
  });
});

describe("resetPassword", () => {
  const validToken = "a".repeat(64); // 32 bytes hex = 64 chars

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    mockHashPassword.mockResolvedValue("$argon2id$new-hash");
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue(null);
  });

  it("resets password with valid token", async () => {
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      tokenHash: expect.any(String),
      expiresAt: new Date(Date.now() + 60 * 60_000), // 1 hour from now
      usedAt: null,
      user: { id: "user-1", email: "user@example.com", displayName: "Test" },
    } as never);

    const result = await resetPassword({
      token: validToken,
      password: "NewSecurePass123!",
      confirmPassword: "NewSecurePass123!",
    });

    expect(result.success).toBe(true);
    // Transaction should execute (password update + token mark used + session delete)
    expect(userRepository.transaction).toHaveBeenCalled();
  });

  it("rejects expired token", async () => {
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
      usedAt: null,
      user: { id: "user-1", email: "user@example.com", displayName: "Test" },
    } as never);

    const result = await resetPassword({
      token: validToken,
      password: "NewSecurePass123!",
      confirmPassword: "NewSecurePass123!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid|expired/i);
    }
  });

  it("rejects already-used token", async () => {
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60 * 60_000),
      usedAt: new Date(), // already used
      user: { id: "user-1", email: "user@example.com", displayName: "Test" },
    } as never);

    const result = await resetPassword({
      token: validToken,
      password: "NewSecurePass123!",
      confirmPassword: "NewSecurePass123!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid|expired/i);
    }
  });

  it("rejects non-existent token", async () => {
    // beforeEach already sets findResetTokenWithUser → null; explicit for clarity
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue(null);

    const result = await resetPassword({
      token: validToken,
      password: "NewSecurePass123!",
      confirmPassword: "NewSecurePass123!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid|expired/i);
    }
  });

  it("rejects weak password during reset", async () => {
    const result = await resetPassword({
      token: validToken,
      password: "short",
      confirmPassword: "short",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors).toBeDefined();
    }
  });

  it("invalidates all sessions after reset", async () => {
    vi.mocked(userRepository.findResetTokenWithUser).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60 * 60_000),
      usedAt: null,
      user: { id: "user-1", email: "user@example.com", displayName: "Test" },
    } as never);

    await resetPassword({
      token: validToken,
      password: "NewSecurePass123!",
      confirmPassword: "NewSecurePass123!",
    });

    // deleteAllSessions called inside transaction
    expect(userRepository.deleteAllSessions).toHaveBeenCalledWith(
      "user-1",
      expect.anything(), // tx
    );
  });
});

describe("changePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    vi.mocked(userRepository.findPasswordHash).mockResolvedValue({
      passwordHash: "$argon2id$existing",
    } as never);
    mockVerifyPassword.mockResolvedValue(true);
    mockHashPassword.mockResolvedValue("$argon2id$new-hash");
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
  });

  it("changes password successfully with correct current password", async () => {
    const result = await changePassword({
      currentPassword: "OldSecurePass1!",
      newPassword: "NewSecurePass123!",
      confirmPassword: "NewSecurePass123!",
    });

    expect(result.success).toBe(true);
    expect(mockVerifyPassword).toHaveBeenCalledWith(
      "$argon2id$existing",
      "OldSecurePass1!",
    );
    expect(mockHashPassword).toHaveBeenCalledWith("NewSecurePass123!");
  });

  it("rejects incorrect current password", async () => {
    mockVerifyPassword.mockResolvedValue(false);

    const result = await changePassword({
      currentPassword: "WrongPassword1!",
      newPassword: "NewSecurePass123!",
      confirmPassword: "NewSecurePass123!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/incorrect/i);
    }
  });

  it("invalidates all sessions after password change", async () => {
    await changePassword({
      currentPassword: "OldSecurePass1!",
      newPassword: "NewSecurePass123!",
      confirmPassword: "NewSecurePass123!",
    });

    // Sessions deleted inside transaction
    expect(userRepository.deleteAllSessions).toHaveBeenCalledWith(
      TEST_USER.id,
      expect.anything(),
    );
  });

  it("rejects if new password is same as current", async () => {
    const result = await changePassword({
      currentPassword: "SamePassword123!",
      newPassword: "SamePassword123!",
      confirmPassword: "SamePassword123!",
    });

    expect(result.success).toBe(false);
  });

  it("rejects social login accounts without password", async () => {
    vi.mocked(userRepository.findPasswordHash).mockResolvedValue(null as never);

    const result = await changePassword({
      currentPassword: "OldSecurePass1!",
      newPassword: "NewSecurePass123!",
      confirmPassword: "NewSecurePass123!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/social login/i);
    }
  });

  it("requires authentication", async () => {
    mockRequireUser.mockRejectedValue(new Error("Unauthorised"));

    const result = await changePassword({
      currentPassword: "OldSecurePass1!",
      newPassword: "NewSecurePass123!",
      confirmPassword: "NewSecurePass123!",
    });

    expect(result.success).toBe(false);
  });
});
