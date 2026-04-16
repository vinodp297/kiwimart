// src/test/mfaLogin.actions.test.ts
// ─── Tests: MFA Login Verification Server Action ────────────────────────────
// Covers verifyMfaLoginAction:
//   unauth, missing code, rate limit, wrong code (audit fail),
//   happy path (markMfaVerified + audit), backup-code metadata

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock MFA service ──────────────────────────────────────────────────────────
const mockVerifyMfaLogin = vi.fn();
vi.mock("@/modules/auth/mfa.service", () => ({
  verifyMfaLogin: (...args: unknown[]) => mockVerifyMfaLogin(...args),
}));

// ── Mock MFA session helper ───────────────────────────────────────────────────
const mockMarkMfaVerified = vi.fn();
vi.mock("@/server/lib/mfaSession", () => ({
  markMfaVerified: (...args: unknown[]) => mockMarkMfaVerified(...args),
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { verifyMfaLoginAction } = await import("@/server/actions/mfaLogin");
const { auth } = await import("@/lib/auth");
const { rateLimit } = await import("@/server/lib/rateLimit");
const { audit } = await import("@/server/lib/audit");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_SESSION = {
  user: { id: "user_mfa", email: "m@test.com" },
};

// ─────────────────────────────────────────────────────────────────────────────
// verifyMfaLoginAction
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyMfaLoginAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(TEST_SESSION as never);
    mockVerifyMfaLogin.mockResolvedValue({
      verified: true,
      backupCodeUsed: false,
    });
    mockMarkMfaVerified.mockResolvedValue(undefined);
  });

  it("no session → returns Not authenticated error", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const result = await verifyMfaLoginAction({ code: "123456" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not authenticated/i);
    }
    expect(mockVerifyMfaLogin).not.toHaveBeenCalled();
  });

  it("session without user id → returns Not authenticated error", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: {} } as never);

    const result = await verifyMfaLoginAction({ code: "123456" });

    expect(result.success).toBe(false);
    expect(mockVerifyMfaLogin).not.toHaveBeenCalled();
  });

  it("missing code (empty string) → returns Code is required error", async () => {
    const result = await verifyMfaLoginAction({ code: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/code is required/i);
    }
    expect(mockVerifyMfaLogin).not.toHaveBeenCalled();
  });

  it("raw input without code key → returns Code is required", async () => {
    const result = await verifyMfaLoginAction({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/code is required/i);
    }
  });

  it("rate limit exceeded → returns too many attempts error", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await verifyMfaLoginAction({ code: "123456" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many attempts/i);
    }
    expect(mockVerifyMfaLogin).not.toHaveBeenCalled();
  });

  it("rate limit scoped to mfa-login:{userId}", async () => {
    await verifyMfaLoginAction({ code: "123456" });

    expect(vi.mocked(rateLimit)).toHaveBeenCalledWith(
      "auth",
      `mfa-login:${TEST_SESSION.user.id}`,
    );
  });

  it("wrong code → logs failed audit and returns Invalid code error", async () => {
    mockVerifyMfaLogin.mockResolvedValueOnce({ verified: false });

    const result = await verifyMfaLoginAction({ code: "000000" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid code/i);
    }
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_SESSION.user.id,
        action: "USER_LOGIN",
        metadata: expect.objectContaining({ mfa: "failed" }),
      }),
    );
    expect(mockMarkMfaVerified).not.toHaveBeenCalled();
  });

  it("correct code → calls markMfaVerified with user key", async () => {
    const result = await verifyMfaLoginAction({ code: "123456" });

    expect(result.success).toBe(true);
    expect(mockMarkMfaVerified).toHaveBeenCalledWith(
      `user:${TEST_SESSION.user.id}`,
    );
  });

  it("correct code → writes verified audit entry", async () => {
    await verifyMfaLoginAction({ code: "123456" });

    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_SESSION.user.id,
        action: "USER_LOGIN",
        metadata: expect.objectContaining({
          mfa: "verified",
          backupCodeUsed: false,
        }),
      }),
    );
  });

  it("backup code used → records backupCodeUsed: true in audit metadata", async () => {
    mockVerifyMfaLogin.mockResolvedValueOnce({
      verified: true,
      backupCodeUsed: true,
    });

    await verifyMfaLoginAction({ code: "BACKUP1234" });

    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          mfa: "verified",
          backupCodeUsed: true,
        }),
      }),
    );
  });

  it("delegates code to verifyMfaLogin alongside user id", async () => {
    await verifyMfaLoginAction({ code: "654321" });

    expect(mockVerifyMfaLogin).toHaveBeenCalledWith(
      TEST_SESSION.user.id,
      "654321",
    );
  });

  it("verifyMfaLogin throws → returns safe fallback error", async () => {
    mockVerifyMfaLogin.mockRejectedValueOnce(new Error("Service down"));

    const result = await verifyMfaLoginAction({ code: "123456" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
      // Must not leak the raw service error
      expect(result.error).not.toMatch(/Service down/);
    }
    expect(mockMarkMfaVerified).not.toHaveBeenCalled();
  });

  it("coerces non-string code values through String()", async () => {
    await verifyMfaLoginAction({ code: 123456 as unknown as string });

    expect(mockVerifyMfaLogin).toHaveBeenCalledWith(
      TEST_SESSION.user.id,
      "123456",
    );
  });

  it("non-object raw input → returns Code is required", async () => {
    const result = await verifyMfaLoginAction(null);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/code is required/i);
    }
  });
});
