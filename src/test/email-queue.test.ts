// src/test/email-queue.test.ts
// ─── Tests: Actions queue emails asynchronously ───────────────────────────────
// Verifies that server actions and services call enqueueEmail() instead of
// sending emails synchronously (inline). These tests use the mocked
// enqueueEmail from setup.ts to assert the job payload shape.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: mockRequireUser,
}));

// ── Mock Turnstile ────────────────────────────────────────────────────────────
vi.mock("@/server/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));

// ── Mock breach check ────────────────────────────────────────────────────────
vi.mock("@/server/lib/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("$argon2id$hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
  isPasswordBreached: vi.fn().mockResolvedValue(false),
}));

// ── Mock user repository ──────────────────────────────────────────────────────
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    existsByEmail: vi.fn().mockResolvedValue(false),
    existsByUsername: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "test@buyzi.test",
      displayName: "Test User",
    }),
    findByEmail: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "test@buyzi.test",
      displayName: "Test User",
    }),
    findEmailVerified: vi.fn().mockResolvedValue({ emailVerified: new Date() }),
    findForEmailVerification: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "test@buyzi.test",
      displayName: "Test User",
      emailVerified: null,
    }),
    update: vi.fn().mockResolvedValue(undefined),
    deleteAllSessions: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock Redis for export rate limiting ───────────────────────────────────────
vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    ping: vi.fn().mockResolvedValue("PONG"),
  }),
}));

// ── Mock session invalidation (erasure) ──────────────────────────────────────
vi.mock("@/server/lib/sessionStore", () => ({
  invalidateAllSessions: vi.fn().mockResolvedValue(1),
  getSessionVersion: vi.fn().mockResolvedValue(0),
}));

// ── Mock mobile token revocation (erasure) ───────────────────────────────────
vi.mock("@/lib/mobile-auth", () => ({
  revokeAllMobileTokens: vi.fn().mockResolvedValue(undefined),
  verifyMobileToken: vi.fn().mockResolvedValue(null),
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { registerUser, requestPasswordReset } =
  await import("@/server/actions/auth");
const { exportUserData } = await import("@/modules/users/export.service");
const { performAccountErasure } =
  await import("@/modules/users/erasure.service");
const { enqueueEmail } = await import("@/lib/email-queue");

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_REGISTER = {
  firstName: "Test",
  lastName: "User",
  username: "testuser",
  email: "test@buyzi.test",
  password: "ValidPass123!",
  confirmPassword: "ValidPass123!",
  agreeTerms: true as const,
  hasMarketingConsent: false,
  turnstileToken: undefined,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("registerUser — queues verification email", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(enqueueEmail).mockResolvedValue(undefined);

    // setup.ts's importOriginal mock for userRepository may win over the test
    // file's full-replacement mock. Guard against that by directly controlling
    // the two db calls that existsByEmail/existsByUsername/create depend on.
    const db = (await import("@/lib/db")).default;
    // null → existsByEmail / existsByUsername both return false (real impl)
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    // Return a valid user so the action can read user.id / user.email
    vi.mocked(db.user.create).mockResolvedValue({
      id: "user-1",
      email: "test@buyzi.test",
      displayName: "Test User",
    } as unknown as Awaited<ReturnType<typeof db.user.create>>);
  });

  it("calls enqueueEmail with verification template after registration", async () => {
    const result = await registerUser(VALID_REGISTER);

    expect(result.success).toBe(true);
    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "verification",
        to: "test@buyzi.test",
      }),
    );
  });

  it("verification job payload includes verifyUrl", async () => {
    await registerUser(VALID_REGISTER);

    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "verification",
        verifyUrl: expect.stringContaining("verify-email"),
      }),
    );
  });

  it("verification job payload includes displayName", async () => {
    await registerUser(VALID_REGISTER);

    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: expect.any(String),
      }),
    );
  });

  it("registration succeeds even when enqueueEmail throws", async () => {
    vi.mocked(enqueueEmail).mockRejectedValueOnce(new Error("Queue down"));

    const result = await registerUser(VALID_REGISTER);

    // Core user creation must still succeed
    expect(result.success).toBe(true);
  });
});

describe("requestPasswordReset — queues passwordReset email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls enqueueEmail with passwordReset template", async () => {
    await requestPasswordReset({ email: "test@buyzi.test" });

    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "passwordReset",
        to: "test@buyzi.test",
        expiresInMinutes: 60,
      }),
    );
  });

  it("passwordReset job payload includes resetUrl", async () => {
    await requestPasswordReset({ email: "test@buyzi.test" });

    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "passwordReset",
        resetUrl: expect.stringContaining("reset-password"),
      }),
    );
  });

  it("always returns success (user enumeration prevention)", async () => {
    const result = await requestPasswordReset({ email: "unknown@buyzi.test" });

    // Even if user not found, returns success
    expect(result.success).toBe(true);
  });
});

describe("exportUserData — queues dataExport email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls enqueueEmail with dataExport template", async () => {
    await exportUserData("user-1", "test@buyzi.test");

    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "dataExport",
        to: "test@buyzi.test",
      }),
    );
  });

  it("dataExport job payload includes jsonPayload", async () => {
    await exportUserData("user-1", "test@buyzi.test");

    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "dataExport",
        jsonPayload: expect.any(String),
      }),
    );
  });

  it("dataExport job payload includes displayName", async () => {
    await exportUserData("user-1", "test@buyzi.test");

    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "dataExport",
        displayName: expect.any(String),
      }),
    );
  });
});

describe("performAccountErasure — queues erasureConfirmation email", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // registerUser's beforeEach may have set db.user.findUnique → null.
    // Restore it so performAccountErasure can capture originalUser before
    // anonymisation (the erasure service checks if originalUser is truthy
    // before queueing the confirmation email).
    const db = (await import("@/lib/db")).default;
    vi.mocked(db.user.findUnique).mockResolvedValue({
      email: "original@buyzi.test",
      displayName: "Original User",
    } as unknown as Awaited<ReturnType<typeof db.user.findUnique>>);
  });

  it("calls enqueueEmail with erasureConfirmation template after erasure", async () => {
    await performAccountErasure({
      userId: "user-pii-test",
      operatorId: "self-service",
    });

    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "erasureConfirmation",
      }),
    );
  });

  it("erasureConfirmation email is sent AFTER erasure succeeds", async () => {
    const callOrder: string[] = [];
    const { userRepository } = await import("@/modules/users/user.repository");
    vi.mocked(userRepository.update).mockImplementation(async () => {
      callOrder.push("userRepository.update");
      return undefined;
    });
    vi.mocked(enqueueEmail).mockImplementation(async () => {
      callOrder.push("enqueueEmail");
      return undefined;
    });

    await performAccountErasure({
      userId: "user-pii-test",
      operatorId: "self-service",
    });

    // update must happen before the email is queued
    const updateIndex = callOrder.indexOf("userRepository.update");
    const emailIndex = callOrder.indexOf("enqueueEmail");
    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(emailIndex).toBeGreaterThan(updateIndex);
  });
});
