// src/test/auth.service.test.ts
// ─── Tests for AuthService.resetPassword token validation ────────────────────
// Verifies all four security checks: token exists, not expired, not used,
// and that the token is marked used atomically with the password update.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { authService } from "@/modules/users/auth.service";
import { AppError } from "@/shared/errors";
import db from "@/lib/db";

const validTokenRecord = {
  id: "token-123",
  userId: "user-123",
  tokenHash: "ignored-hash-mocked-below",
  expiresAt: new Date(Date.now() + 3_600_000), // 1 hour from now
  usedAt: null,
  requestIp: "127.0.0.1",
  userAgent: null,
  createdAt: new Date(),
  user: { id: "user-123", email: "test@test.com", displayName: "Test User" },
};

describe("AuthService.resetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects expired token — does not touch DB", async () => {
    vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue({
      ...validTokenRecord,
      expiresAt: new Date(Date.now() - 1_000), // 1 second in the past
    } as never);

    await expect(
      authService.resetPassword(
        { token: "raw-token", password: "NewPass123!" },
        "127.0.0.1",
      ),
    ).rejects.toThrow(AppError);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects already-used token — does not touch DB", async () => {
    vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue({
      ...validTokenRecord,
      usedAt: new Date(), // already consumed
    } as never);

    await expect(
      authService.resetPassword(
        { token: "raw-token", password: "NewPass123!" },
        "127.0.0.1",
      ),
    ).rejects.toThrow(AppError);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects missing token — does not touch DB", async () => {
    vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue(
      null as never,
    );

    await expect(
      authService.resetPassword(
        { token: "no-such-token", password: "NewPass123!" },
        "127.0.0.1",
      ),
    ).rejects.toThrow(AppError);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("marks token as used atomically with password update on success", async () => {
    vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue(
      validTokenRecord as never,
    );
    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function")
        return (fn as (tx: typeof db) => Promise<unknown>)(db);
      return [];
    });

    await authService.resetPassword(
      { token: "raw-token", password: "NewStrongPass123!" },
      "127.0.0.1",
    );

    // Must use a single atomic transaction — not separate calls
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // Password update and token invalidation must both be inside it
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-123" },
        data: expect.objectContaining({ passwordHash: expect.any(String) }),
      }),
    );
    expect(db.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "token-123" },
        data: { usedAt: expect.any(Date) },
      }),
    );
  });
});
