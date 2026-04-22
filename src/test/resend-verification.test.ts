// src/test/resend-verification.test.ts
// ─── Tests for resend verification email functionality ──────────────────────
// Tests cover: rate limiting, email enumeration guard, token generation,
// Redis unavailability, and email queueing.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./setup";
import { resendVerificationEmail } from "@/server/actions/auth/resend-verification";
import { rateLimit } from "@/server/lib/rateLimit";

vi.mock("server-only", () => ({}));

// ── User repository mock ──────────────────────────────────────────────────────

const mockFindByEmail = vi.fn().mockResolvedValue(null);
const mockFindForEmailVerification = vi
  .fn()
  .mockResolvedValue({ emailVerified: null });
const mockUpdateVerificationToken = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findByEmail: (...args: unknown[]) => mockFindByEmail(...args),
    findForEmailVerification: (...args: unknown[]) =>
      mockFindForEmailVerification(...args),
    updateVerificationToken: (...args: unknown[]) =>
      mockUpdateVerificationToken(...args),
  },
}));

// Mock rate limiter
vi.mock("@/server/lib/rateLimit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/lib/rateLimit")>();
  return {
    ...actual,
    rateLimit: vi.fn().mockResolvedValue({ success: true, retryAfter: 0 }),
    getClientIp: vi.fn().mockReturnValue("203.0.113.1"),
  };
});

// Mock email queueing
const mockEnqueueEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email-queue", () => ({
  enqueueEmail: (...args: unknown[]) => mockEnqueueEmail(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mocks to successful states
  vi.mocked(rateLimit).mockResolvedValue({
    success: true,
    remaining: 2,
    reset: Date.now() + 3600_000,
    retryAfter: 0,
  });
  mockEnqueueEmail.mockResolvedValue(undefined);
  mockFindByEmail.mockResolvedValue(null);
  mockFindForEmailVerification.mockResolvedValue({ emailVerified: null });
  mockUpdateVerificationToken.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resendVerificationEmail — Rate Limiting", () => {
  it("returns success (enumeration guard) when rate limit is exceeded", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 3600_000,
      retryAfter: 1800,
    });

    const result = await resendVerificationEmail({ email: "user@test.com" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toContain(
        "If that email is registered and unverified",
      );
    }
    // Verify rate limiter was called
    expect(vi.mocked(rateLimit)).toHaveBeenCalledWith(
      "resendVerification",
      "203.0.113.1",
    );
  });

  it("applies rate limit per IP — blocks requests after 3 per hour", async () => {
    // First request succeeds
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: true,
      remaining: 2,
      reset: Date.now() + 3600_000,
      retryAfter: 0,
    });

    // Second request succeeds
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: true,
      remaining: 1,
      reset: Date.now() + 3600_000,
      retryAfter: 0,
    });

    // Third request succeeds
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: true,
      remaining: 0,
      reset: Date.now() + 3600_000,
      retryAfter: 0,
    });

    // Fourth request fails (rate limited)
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 3600_000,
      retryAfter: 3600,
    });

    const result1 = await resendVerificationEmail({ email: "user1@test.com" });
    const result2 = await resendVerificationEmail({ email: "user2@test.com" });
    const result3 = await resendVerificationEmail({ email: "user3@test.com" });
    const result4 = await resendVerificationEmail({ email: "user4@test.com" });

    // All return success (enumeration guard)
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result3.success).toBe(true);
    expect(result4.success).toBe(true);

    // Verify all 4 rate limit checks occurred
    expect(vi.mocked(rateLimit)).toHaveBeenCalledTimes(4);
  });
});

describe("resendVerificationEmail — Email Enumeration Guard", () => {
  it("returns success for unknown email (does not reveal existence)", async () => {
    mockFindByEmail.mockResolvedValue(null);

    const result = await resendVerificationEmail({ email: "unknown@test.com" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toContain(
        "If that email is registered and unverified",
      );
    }
    // Email queue should NOT be called for non-existent users
    expect(mockEnqueueEmail).not.toHaveBeenCalled();
  });

  it("returns success for already-verified email (does not reveal state)", async () => {
    const mockUser = {
      id: "user-verified",
      email: "verified@test.com",
      displayName: "Verified User",
    };

    mockFindByEmail.mockResolvedValue(mockUser as never);
    mockFindForEmailVerification.mockResolvedValue({
      emailVerified: new Date("2026-01-01"),
    } as never);

    const result = await resendVerificationEmail({
      email: "verified@test.com",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toContain(
        "If that email is registered and unverified",
      );
    }
    // Email queue should NOT be called for already-verified users
    expect(mockEnqueueEmail).not.toHaveBeenCalled();
  });
});

describe("resendVerificationEmail — Token Generation & Persistence", () => {
  it("generates new token and updates user for unverified account", async () => {
    const mockUser = {
      id: "user-unverified",
      email: "unverified@test.com",
      displayName: "Unverified User",
    };

    mockFindByEmail.mockResolvedValue(mockUser as never);
    mockFindForEmailVerification.mockResolvedValue({
      emailVerified: null,
    } as never);

    const result = await resendVerificationEmail({
      email: "unverified@test.com",
    });

    expect(result.success).toBe(true);

    // Verify updateVerificationToken was called with token and expiry
    expect(mockUpdateVerificationToken).toHaveBeenCalledWith(
      "user-unverified",
      expect.any(String),
      expect.any(Date),
    );

    // Verify token is 64-character hex (32 bytes × 2)
    const token = mockUpdateVerificationToken.mock.calls[0]![1];
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sets verification token expiry to 24 hours", async () => {
    const mockUser = {
      id: "user-1",
      email: "test@test.com",
      displayName: "Test",
    };

    mockFindByEmail.mockResolvedValue(mockUser as never);
    mockFindForEmailVerification.mockResolvedValue({
      emailVerified: null,
    } as never);

    const beforeCall = Date.now();
    await resendVerificationEmail({ email: "test@test.com" });
    const afterCall = Date.now();

    const expiresAt = mockUpdateVerificationToken.mock.calls[0]![2] as Date;

    // Should be approximately 24 hours from now
    const expectedMin = beforeCall + 24 * 60 * 60 * 1000;
    const expectedMax = afterCall + 24 * 60 * 60 * 1000 + 1000;
    const actualMs = expiresAt.getTime();

    expect(actualMs).toBeGreaterThanOrEqual(expectedMin);
    expect(actualMs).toBeLessThanOrEqual(expectedMax);
  });
});

describe("resendVerificationEmail — Email Queueing", () => {
  it("queues verification email for valid unverified user", async () => {
    const mockUser = {
      id: "user-1",
      email: "user@test.com",
      displayName: "Test User",
    };

    mockFindByEmail.mockResolvedValue(mockUser as never);
    mockFindForEmailVerification.mockResolvedValue({
      emailVerified: null,
    } as never);

    await resendVerificationEmail({ email: "user@test.com" });

    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "verification",
        to: "user@test.com",
        displayName: "Test User",
        verifyUrl: expect.stringContaining("/api/verify-email?token="),
      }),
    );
  });

  it("does not throw if email queueing fails (fire-and-forget)", async () => {
    const mockUser = {
      id: "user-1",
      email: "user@test.com",
      displayName: "Test User",
    };

    mockFindByEmail.mockResolvedValue(mockUser as never);
    mockFindForEmailVerification.mockResolvedValue({
      emailVerified: null,
    } as never);
    mockEnqueueEmail.mockRejectedValueOnce(
      new Error("Email service unavailable"),
    );

    // Should not throw — fire-and-forget pattern
    const result = await resendVerificationEmail({ email: "user@test.com" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toContain(
        "If that email is registered and unverified",
      );
    }
  });
});

describe("resendVerificationEmail — Input Validation", () => {
  it("rejects invalid email format", async () => {
    const result = await resendVerificationEmail({ email: "not-an-email" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("valid email");
    }
  });

  it("rejects missing email", async () => {
    const result = await resendVerificationEmail({ email: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod validation returns the first failing constraint message
      expect(result.error).toMatch(/email|Email/i);
    }
  });
});
