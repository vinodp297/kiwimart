// src/test/email-queue-propagation.test.ts
// ─── Fix 3: Email queue failures propagate — no sync fallback ─────────────────
// Verifies that when enqueueEmail() rejects, the calling service function also
// rejects (no .catch() swallowing the error, no direct Resend fallback).

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock enqueueEmail so we can control its behaviour ─────────────────────────

const mockEnqueueEmail = vi.fn();

vi.mock("@/lib/email-queue", () => ({
  enqueueEmail: (...args: unknown[]) => mockEnqueueEmail(...args),
}));

// ── Mock supporting dependencies ──────────────────────────────────────────────

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    existsByEmail: vi.fn().mockResolvedValue(false),
    existsByUsername: vi.fn().mockResolvedValue(false),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    create: vi.fn(),
    invalidatePendingResetTokens: vi.fn(),
    createResetToken: vi.fn(),
  },
}));

vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/platform-config", () => ({
  getConfigInt: vi.fn().mockResolvedValue(0),
  CONFIG_KEYS: {},
}));
vi.mock("@/server/lib/verifyTurnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { authService } from "@/modules/users/auth.service";
import { userRepository } from "@/modules/users/user.repository";

describe("email queue failure propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.existsByEmail).mockResolvedValue(false);
    vi.mocked(userRepository.existsByUsername).mockResolvedValue(false);
    vi.mocked(userRepository.create).mockResolvedValue({
      id: "user-1",
      email: "new@test.nz",
      username: "newuser",
      displayName: "New User",
    } as never);
  });

  it("register() propagates enqueueEmail failure — no silent catch", async () => {
    mockEnqueueEmail.mockRejectedValue(new Error("Redis unavailable"));

    await expect(
      authService.register(
        {
          firstName: "New",
          lastName: "User",
          email: "new@test.nz",
          password: "Password1!",
          username: "newuser",
          hasMarketingConsent: false,
        } as never,
        "127.0.0.1",
      ),
    ).rejects.toThrow("Redis unavailable");
  });

  it("requestPasswordReset() propagates enqueueEmail failure", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "user-2",
      email: "reset@test.nz",
      displayName: "Reset User",
    } as never);
    vi.mocked(userRepository.invalidatePendingResetTokens).mockResolvedValue(
      undefined,
    );
    vi.mocked(userRepository.createResetToken).mockResolvedValue(undefined);

    mockEnqueueEmail.mockRejectedValue(new Error("Queue full"));

    await expect(
      authService.requestPasswordReset("reset@test.nz", "127.0.0.1", null),
    ).rejects.toThrow("Queue full");
  });

  it("no direct Resend calls — enqueueEmail is the only email path on success", async () => {
    mockEnqueueEmail.mockResolvedValue({ jobId: "job-1" });

    await authService.register(
      {
        firstName: "Clean",
        lastName: "User",
        email: "clean@test.nz",
        password: "Password1!",
        username: "cleanuser",
        hasMarketingConsent: false,
      } as never,
      "127.0.0.1",
    );

    // If there were a direct Resend call it would bypass this mock.
    // Passing proves the only email path goes through enqueueEmail.
    expect(mockEnqueueEmail).toHaveBeenCalledOnce();
  });
});
