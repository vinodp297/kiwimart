// src/test/auth-password.extra.test.ts
// ─── Supplementary Tests: Password — resendVerificationEmail ────────────────
// Adds coverage for resendVerificationEmail branches not already tested in
// auth-actions.test.ts. Targets auth/password.ts (was 61%).

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock turnstile ────────────────────────────────────────────────────────────
vi.mock("@/server/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));

// ── Mock user repository ──────────────────────────────────────────────────────
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findForEmailVerification: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    // Used by auth.ts on login; stub so setup doesn't blow up
    findEmailVerified: vi.fn().mockResolvedValue({ emailVerified: new Date() }),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { resendVerificationEmail } =
  await import("@/server/actions/auth/password");
const { auth } = await import("@/lib/auth");
const { userRepository } = await import("@/modules/users/user.repository");
const { rateLimit } = await import("@/server/lib/rateLimit");
const { enqueueEmail } = await import("@/lib/email-queue");
const { audit } = await import("@/server/lib/audit");

// ─────────────────────────────────────────────────────────────────────────────
// resendVerificationEmail
// ─────────────────────────────────────────────────────────────────────────────

describe("resendVerificationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user_unv", email: "u@test.com" },
    } as never);
    vi.mocked(userRepository.findForEmailVerification).mockResolvedValue({
      id: "user_unv",
      email: "u@test.com",
      displayName: "Unverified User",
      emailVerified: null,
    } as never);
    vi.mocked(userRepository.update).mockResolvedValue(undefined as never);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 9,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
  });

  it("rate limit exceeded → returns too many attempts error", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 120,
    });

    const result = await resendVerificationEmail();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many attempts/i);
    }
    expect(userRepository.findForEmailVerification).not.toHaveBeenCalled();
  });

  it("no session → returns Not logged in error", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const result = await resendVerificationEmail();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not logged in/i);
    }
  });

  it("session without user id → returns Not logged in", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: {} } as never);

    const result = await resendVerificationEmail();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not logged in/i);
    }
  });

  it("user not found in repository → returns User not found error", async () => {
    vi.mocked(userRepository.findForEmailVerification).mockResolvedValueOnce(
      null as never,
    );

    const result = await resendVerificationEmail();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/user not found/i);
    }
  });

  it("email already verified → returns already verified error", async () => {
    vi.mocked(userRepository.findForEmailVerification).mockResolvedValueOnce({
      id: "user_unv",
      email: "u@test.com",
      displayName: "Verified User",
      emailVerified: new Date("2026-01-01"),
    } as never);

    const result = await resendVerificationEmail();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already verified/i);
    }
  });

  it("happy path → updates token, enqueues email, writes audit, returns success", async () => {
    const result = await resendVerificationEmail();

    expect(result.success).toBe(true);
    expect(userRepository.update).toHaveBeenCalledWith(
      "user_unv",
      expect.objectContaining({
        emailVerifyToken: expect.any(String),
        emailVerifyExpires: expect.any(Date),
      }),
    );
    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "verification",
        to: "u@test.com",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_unv",
        action: "USER_PASSWORD_CHANGED",
        metadata: expect.objectContaining({
          step: "verification_email_resent",
        }),
      }),
    );
  });

  it("enqueueEmail throws → still returns success (error is caught)", async () => {
    vi.mocked(enqueueEmail).mockRejectedValueOnce(new Error("Redis down"));

    const result = await resendVerificationEmail();

    // Email failure shouldn't block success response (user is allowed retry)
    expect(result.success).toBe(true);
  });

  it("displayName null → uses 'there' fallback in enqueueEmail payload", async () => {
    vi.mocked(userRepository.findForEmailVerification).mockResolvedValueOnce({
      id: "user_unv",
      email: "u@test.com",
      displayName: null,
      emailVerified: null,
    } as never);

    await resendVerificationEmail();

    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "there" }),
    );
  });

  it("token is unique per call (random bytes)", async () => {
    await resendVerificationEmail();
    const firstToken = vi.mocked(userRepository.update).mock.calls[0]?.[1] as {
      emailVerifyToken: string;
    };

    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user_unv", email: "u@test.com" },
    } as never);
    vi.mocked(userRepository.findForEmailVerification).mockResolvedValue({
      id: "user_unv",
      email: "u@test.com",
      displayName: "Unverified User",
      emailVerified: null,
    } as never);
    vi.mocked(userRepository.update).mockResolvedValue(undefined as never);

    await resendVerificationEmail();
    const secondToken = vi.mocked(userRepository.update).mock.calls[0]?.[1] as {
      emailVerifyToken: string;
    };

    expect(firstToken.emailVerifyToken).not.toBe(secondToken.emailVerifyToken);
  });

  it("verify URL uses NEXT_PUBLIC_APP_URL env var", async () => {
    const originalUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://buyzi.example.com";

    await resendVerificationEmail();

    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        verifyUrl: expect.stringContaining(
          "https://buyzi.example.com/api/verify-email?token=",
        ),
      }),
    );

    process.env.NEXT_PUBLIC_APP_URL = originalUrl;
  });
});
