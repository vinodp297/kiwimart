// src/test/mfa-actions.test.ts
// ─── Tests: MFA Server Actions ──────────────────────────────────────────────
// Covers:
//   initMfaSetup — generates secret + QR + backup codes, rate limit, already enabled
//   confirmMfaSetup — valid code enables, invalid code rejects, rate limit
//   disableMfaAction — valid code disables, invalid code rejects
//   getMfaStatus — enabled/disabled, backup code count

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: mockRequireUser,
}));

// ── Mock MFA service ────────────────────────────────────────────────────────
const mockSetupMfa = vi.fn();
const mockVerifyMfaSetup = vi.fn();
const mockDisableMfa = vi.fn();
const mockGetBackupCodeCount = vi.fn();

vi.mock("@/modules/auth/mfa.service", () => ({
  setupMfa: (...args: unknown[]) => mockSetupMfa(...args),
  verifyMfaSetup: (...args: unknown[]) => mockVerifyMfaSetup(...args),
  disableMfa: (...args: unknown[]) => mockDisableMfa(...args),
  getBackupCodeCount: (...args: unknown[]) => mockGetBackupCodeCount(...args),
}));

// ── Mock user repository ────────────────────────────────────────────────────
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findMfaInfo: vi.fn(),
    findEmailVerified: vi.fn().mockResolvedValue({ emailVerified: new Date() }),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { initMfaSetup, confirmMfaSetup, disableMfaAction, getMfaStatus } =
  await import("@/server/actions/mfa");
const { userRepository } = await import("@/modules/users/user.repository");
const { rateLimit } = await import("@/server/lib/rateLimit");

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_USER = {
  id: "user-mfa-test",
  email: "mfa@buyzi.test",
  isAdmin: false,
  isSellerEnabled: false,
  isStripeOnboarded: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("initMfaSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    vi.mocked(userRepository.findMfaInfo).mockResolvedValue({
      isMfaEnabled: false,
      email: "mfa@buyzi.test",
    } as never);
    mockSetupMfa.mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      qrCodeUrl:
        "otpauth://totp/KiwiMart:mfa@buyzi.test?secret=JBSWY3DPEHPK3PXP",
      backupCodes: ["CODE1111", "CODE2222", "CODE3333"],
    });
  });

  it("generates TOTP secret, QR URL, and backup codes", async () => {
    const result = await initMfaSetup();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.secret).toBe("JBSWY3DPEHPK3PXP");
      expect(result.data.qrCodeUrl).toContain("otpauth://totp/");
      expect(result.data.backupCodes).toHaveLength(3);
    }
    expect(mockSetupMfa).toHaveBeenCalledWith(TEST_USER.id, "mfa@buyzi.test");
  });

  it("rejects if MFA already enabled", async () => {
    vi.mocked(userRepository.findMfaInfo).mockResolvedValue({
      isMfaEnabled: true,
      email: "mfa@buyzi.test",
    } as never);

    const result = await initMfaSetup();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already enabled/i);
    }
    expect(mockSetupMfa).not.toHaveBeenCalled();
  });

  it("rate limits MFA setup requests", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 120,
    });

    const result = await initMfaSetup();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many/i);
    }
  });

  it("returns error if user not found", async () => {
    vi.mocked(userRepository.findMfaInfo).mockResolvedValue(null);

    const result = await initMfaSetup();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not found/i);
    }
  });

  it("requires authentication", async () => {
    mockRequireUser.mockRejectedValue(new Error("Unauthorised"));

    const result = await initMfaSetup();

    expect(result.success).toBe(false);
  });
});

describe("confirmMfaSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
  });

  it("enables MFA with valid TOTP code", async () => {
    mockVerifyMfaSetup.mockResolvedValue({ verified: true });

    const result = await confirmMfaSetup({ code: "123456" });

    expect(result.success).toBe(true);
    expect(mockVerifyMfaSetup).toHaveBeenCalledWith(TEST_USER.id, "123456");
  });

  it("rejects invalid TOTP code", async () => {
    mockVerifyMfaSetup.mockResolvedValue({ verified: false });

    const result = await confirmMfaSetup({ code: "000000" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid|try again/i);
    }
  });

  it("rejects non-6-digit code (validation)", async () => {
    const result = await confirmMfaSetup({ code: "12345" }); // 5 digits

    expect(result.success).toBe(false);
    expect(mockVerifyMfaSetup).not.toHaveBeenCalled();
  });

  it("rejects non-numeric code (validation)", async () => {
    const result = await confirmMfaSetup({ code: "abcdef" });

    expect(result.success).toBe(false);
    expect(mockVerifyMfaSetup).not.toHaveBeenCalled();
  });

  it("rate limits verification attempts", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await confirmMfaSetup({ code: "123456" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many/i);
    }
  });
});

describe("disableMfaAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
  });

  it("disables MFA with valid TOTP code", async () => {
    mockDisableMfa.mockResolvedValue({ success: true });

    const result = await disableMfaAction({ code: "123456" });

    expect(result.success).toBe(true);
    expect(mockDisableMfa).toHaveBeenCalledWith(TEST_USER.id, "123456");
  });

  it("rejects invalid TOTP code", async () => {
    mockDisableMfa.mockResolvedValue({ success: false });

    const result = await disableMfaAction({ code: "000000" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid|not disabled/i);
    }
  });

  it("rate limits disable attempts", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await disableMfaAction({ code: "123456" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many/i);
    }
  });
});

describe("getMfaStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
  });

  it("returns enabled status with backup code count", async () => {
    vi.mocked(userRepository.findMfaInfo).mockResolvedValue({
      isMfaEnabled: true,
      email: "mfa@buyzi.test",
    } as never);
    mockGetBackupCodeCount.mockResolvedValue(8);

    const result = await getMfaStatus();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.backupCodesRemaining).toBe(8);
    }
  });

  it("returns disabled status with zero backup codes", async () => {
    vi.mocked(userRepository.findMfaInfo).mockResolvedValue({
      isMfaEnabled: false,
      email: "mfa@buyzi.test",
    } as never);

    const result = await getMfaStatus();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.backupCodesRemaining).toBe(0);
    }
    // Should NOT call getBackupCodeCount when MFA is disabled
    expect(mockGetBackupCodeCount).not.toHaveBeenCalled();
  });

  it("returns error if user not found", async () => {
    vi.mocked(userRepository.findMfaInfo).mockResolvedValue(null);

    const result = await getMfaStatus();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not found/i);
    }
  });
});
