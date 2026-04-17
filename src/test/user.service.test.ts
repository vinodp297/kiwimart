// src/test/user.service.test.ts
// ─── Tests: UserService ──────────────────────────────────────────────────────
// Covers profile update, password change flow (with social-login and bad-
// password guards), phone verification request + confirm, phone encryption
// fallback, and the thin page-data delegations.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock @/env ──────────────────────────────────────────────────────────────
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_APP_NAME: "Kiwi Cart",
  },
}));

// ── Mock user repository ─────────────────────────────────────────────────────
const mockRepo = {
  update: vi.fn(),
  findPasswordHash: vi.fn(),
  transaction: vi.fn(),
  deleteAllSessions: vi.fn(),
  deletePhoneTokens: vi.fn(),
  createPhoneToken: vi.fn(),
  findActivePhoneToken: vi.fn(),
  incrementPhoneTokenAttempts: vi.fn(),
  markPhoneTokenUsed: vi.fn(),
  findPhone: vi.fn(),
  findForApiProfile: vi.fn(),
  findForNavSummary: vi.fn(),
  findOnboardingStatus: vi.fn(),
  findForSettings: vi.fn(),
  findBlockedUsers: vi.fn(),
  findForSellerHub: vi.fn(),
  findPublicSellerPageData: vi.fn(),
  findBlockStatus: vi.fn(),
  findBusinessInfo: vi.fn(),
  findForMessageRecipient: vi.fn(),
  findEmailById: vi.fn(),
};

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: mockRepo,
}));

// ── Mock encryption (deterministic) ──────────────────────────────────────────
vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn((val: string) => `enc:${val}`),
  decrypt: vi.fn((val: string) =>
    val.startsWith("enc:") ? val.slice(4) : val,
  ),
  isEncryptionConfigured: vi.fn(() => true),
}));

// ── Mock SMS service (dynamic import inside service) ─────────────────────────
const mockIsValidNzPhone = vi.fn((p: string) => /^(0|\+64)?2\d{7,9}$/.test(p));
const mockSendSms = vi.fn().mockResolvedValue(undefined);
const mockFormatNzPhoneE164 = vi.fn((p: string) => `+64${p.replace(/^0/, "")}`);
vi.mock("@/server/services/sms/sms.service", () => ({
  isValidNzPhone: mockIsValidNzPhone,
  sendSms: mockSendSms,
  formatNzPhoneE164: mockFormatNzPhoneE164,
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { userService } = await import("@/modules/users/user.service");
const { audit } = await import("@/server/lib/audit");
const { hashPassword, verifyPassword } = await import("@/server/lib/password");
const encryptionMod = await import("@/lib/encryption");

// ─────────────────────────────────────────────────────────────────────────────

describe("UserService.updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.update.mockResolvedValue(undefined);
  });

  it("passes through to repository with normalised nulls", async () => {
    await userService.updateProfile("user_1", {
      displayName: "Alice",
      region: "",
      bio: "",
    });

    expect(mockRepo.update).toHaveBeenCalledWith("user_1", {
      displayName: "Alice",
      region: null,
      bio: null,
    });
  });

  it("keeps non-empty region/bio", async () => {
    await userService.updateProfile("user_2", {
      displayName: "Bob",
      region: "Wellington",
      bio: "Seller of vintage finds",
    });

    expect(mockRepo.update).toHaveBeenCalledWith("user_2", {
      displayName: "Bob",
      region: "Wellington",
      bio: "Seller of vintage finds",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("UserService.changePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  it("rejects social-login accounts (no passwordHash)", async () => {
    mockRepo.findPasswordHash.mockResolvedValueOnce({ passwordHash: null });

    await expect(
      userService.changePassword(
        "user_1",
        { currentPassword: "old", newPassword: "NewPass123!" },
        "127.0.0.1",
      ),
    ).rejects.toThrow(/social login/i);
  });

  it("rejects when currentPassword fails verification → audits failure", async () => {
    mockRepo.findPasswordHash.mockResolvedValueOnce({ passwordHash: "hash" });
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);

    await expect(
      userService.changePassword(
        "user_1",
        { currentPassword: "wrong", newPassword: "NewPass123!" },
        "127.0.0.1",
      ),
    ).rejects.toThrow(/current password is incorrect/i);

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        action: "PASSWORD_CHANGED",
        metadata: expect.objectContaining({ success: false }),
      }),
    );
    expect(mockRepo.update).not.toHaveBeenCalled();
  });

  it("happy path → hashes new pw, updates & deletes sessions, audits success", async () => {
    mockRepo.findPasswordHash.mockResolvedValueOnce({ passwordHash: "hash" });
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(hashPassword).mockResolvedValueOnce("$argon2id$new");

    await userService.changePassword(
      "user_1",
      { currentPassword: "old", newPassword: "NewPass123!" },
      "127.0.0.1",
    );

    expect(mockRepo.update).toHaveBeenCalledWith(
      "user_1",
      { passwordHash: "$argon2id$new" },
      expect.any(Object),
    );
    expect(mockRepo.deleteAllSessions).toHaveBeenCalledWith(
      "user_1",
      expect.any(Object),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        action: "PASSWORD_CHANGED",
        metadata: { success: true },
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("UserService.requestPhoneVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.update.mockResolvedValue(undefined);
    mockRepo.deletePhoneTokens.mockResolvedValue(undefined);
    mockRepo.createPhoneToken.mockResolvedValue(undefined);
    mockIsValidNzPhone.mockReturnValue(true);
  });

  it("rejects invalid NZ phone numbers", async () => {
    mockIsValidNzPhone.mockReturnValueOnce(false);

    await expect(
      userService.requestPhoneVerification("user_1", "123", "127.0.0.1"),
    ).rejects.toThrow(/valid New Zealand phone/i);

    expect(mockRepo.createPhoneToken).not.toHaveBeenCalled();
  });

  it("strips formatting (spaces, dashes, parens) before validating", async () => {
    await userService.requestPhoneVerification(
      "user_1",
      "(021) 555-1234",
      "127.0.0.1",
    );

    expect(mockIsValidNzPhone).toHaveBeenCalledWith("0215551234");
    expect(mockRepo.createPhoneToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1", phone: "0215551234" }),
    );
  });

  it("generates a 6-digit code, hashes it, sets 10-minute expiry", async () => {
    const before = Date.now();

    const result = await userService.requestPhoneVerification(
      "user_1",
      "0215551234",
      "127.0.0.1",
    );

    const call = mockRepo.createPhoneToken.mock.calls[0]?.[0] as {
      codeHash: string;
      expiresAt: Date;
    };
    // SHA-256 hex
    expect(call.codeHash).toMatch(/^[a-f0-9]{64}$/);
    // 10 minutes ± 2s
    const expiresMs = call.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 10 * 60_000 - 2000);
    expect(expiresMs).toBeLessThanOrEqual(before + 10 * 60_000 + 2000);
    expect(result.expiresAt).toBe(call.expiresAt.toISOString());
  });

  it("sends SMS via sms.service with E.164 formatted number", async () => {
    await userService.requestPhoneVerification(
      "user_1",
      "0215551234",
      "127.0.0.1",
    );

    expect(mockFormatNzPhoneE164).toHaveBeenCalledWith("0215551234");
    expect(mockSendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: expect.stringMatching(/^\+64/),
        body: expect.stringContaining("Kiwi Cart verification code"),
      }),
    );
  });

  it("stores encrypted phone on user record (only last 4 in audit)", async () => {
    await userService.requestPhoneVerification(
      "user_1",
      "0215551234",
      "127.0.0.1",
    );

    expect(mockRepo.update).toHaveBeenCalledWith("user_1", {
      phone: "enc:0215551234",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PHONE_VERIFIED",
        metadata: expect.objectContaining({
          step: "code_requested",
          phone: "1234",
        }),
      }),
    );
  });

  it("deletes old phone tokens before creating new one", async () => {
    await userService.requestPhoneVerification(
      "user_1",
      "0215551234",
      "127.0.0.1",
    );

    expect(mockRepo.deletePhoneTokens).toHaveBeenCalledWith("user_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("UserService.verifyPhoneCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.incrementPhoneTokenAttempts.mockResolvedValue(undefined);
    mockRepo.markPhoneTokenUsed.mockResolvedValue(undefined);
    mockRepo.update.mockResolvedValue(undefined);
    mockRepo.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  it("rejects non-6-digit codes", async () => {
    await expect(
      userService.verifyPhoneCode("user_1", "12", "127.0.0.1"),
    ).rejects.toThrow(/6-digit/);
    expect(mockRepo.findActivePhoneToken).not.toHaveBeenCalled();
  });

  it("rejects when no active token (expired / never requested)", async () => {
    mockRepo.findActivePhoneToken.mockResolvedValueOnce(null);

    await expect(
      userService.verifyPhoneCode("user_1", "123456", "127.0.0.1"),
    ).rejects.toThrow(/expired/i);
  });

  it("rejects after 3 failed attempts", async () => {
    mockRepo.findActivePhoneToken.mockResolvedValueOnce({
      id: "t_1",
      attempts: 3,
      codeHash: "ignored",
      phone: "0215551234",
    });

    await expect(
      userService.verifyPhoneCode("user_1", "123456", "127.0.0.1"),
    ).rejects.toThrow(/too many attempts/i);
    expect(mockRepo.incrementPhoneTokenAttempts).not.toHaveBeenCalled();
  });

  it("rejects wrong code and increments attempts", async () => {
    mockRepo.findActivePhoneToken.mockResolvedValueOnce({
      id: "t_1",
      attempts: 0,
      codeHash: "wrong-hash",
      phone: "0215551234",
    });

    await expect(
      userService.verifyPhoneCode("user_1", "123456", "127.0.0.1"),
    ).rejects.toThrow(/invalid verification code/i);
    expect(mockRepo.incrementPhoneTokenAttempts).toHaveBeenCalledWith("t_1");
    expect(mockRepo.markPhoneTokenUsed).not.toHaveBeenCalled();
  });

  it("happy path → marks token used, flips isPhoneVerified, encrypts phone", async () => {
    // sha256("123456")
    const crypto = await import("crypto");
    const hash = crypto.createHash("sha256").update("123456").digest("hex");

    mockRepo.findActivePhoneToken.mockResolvedValueOnce({
      id: "t_1",
      attempts: 0,
      codeHash: hash,
      phone: "0215551234",
    });

    await userService.verifyPhoneCode("user_1", "123456", "127.0.0.1");

    expect(mockRepo.markPhoneTokenUsed).toHaveBeenCalledWith(
      "t_1",
      expect.any(Object),
    );
    expect(mockRepo.update).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        isPhoneVerified: true,
        phone: "enc:0215551234",
      }),
      expect.any(Object),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PHONE_VERIFIED",
        metadata: expect.objectContaining({
          step: "verified",
          phone: "1234",
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("UserService.getDecryptedPhone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when user has no phone on record", async () => {
    mockRepo.findPhone.mockResolvedValueOnce({ phone: null });

    const result = await userService.getDecryptedPhone("user_1");

    expect(result).toBeNull();
  });

  it("returns null when user not found", async () => {
    mockRepo.findPhone.mockResolvedValueOnce(null);

    const result = await userService.getDecryptedPhone("user_1");

    expect(result).toBeNull();
  });

  it("decrypts the stored value when encryption configured", async () => {
    mockRepo.findPhone.mockResolvedValueOnce({ phone: "enc:0215551234" });

    const result = await userService.getDecryptedPhone("user_1");

    expect(result).toBe("0215551234");
  });

  it("passes raw value through when encryption not configured", async () => {
    vi.mocked(encryptionMod.isEncryptionConfigured).mockReturnValueOnce(false);
    mockRepo.findPhone.mockResolvedValueOnce({ phone: "raw-0215551234" });

    const result = await userService.getDecryptedPhone("user_1");

    expect(result).toBe("raw-0215551234");
  });

  it("returns the stored value as-is when decrypt throws (legacy rows)", async () => {
    vi.mocked(encryptionMod.decrypt).mockImplementationOnce(() => {
      throw new Error("Not base64");
    });
    mockRepo.findPhone.mockResolvedValueOnce({ phone: "legacy-raw-phone" });

    const result = await userService.getDecryptedPhone("user_1");

    expect(result).toBe("legacy-raw-phone");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Thin delegation getters — assert pass-through + argument forwarding.
// ─────────────────────────────────────────────────────────────────────────────

describe("UserService — thin delegations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getApiProfile delegates to findForApiProfile", async () => {
    mockRepo.findForApiProfile.mockResolvedValueOnce({ id: "u" });
    await expect(userService.getApiProfile("u")).resolves.toEqual({ id: "u" });
    expect(mockRepo.findForApiProfile).toHaveBeenCalledWith("u");
  });

  it("getNavSummaryUser delegates", async () => {
    await userService.getNavSummaryUser("u");
    expect(mockRepo.findForNavSummary).toHaveBeenCalledWith("u");
  });

  it("getWelcomePageData delegates", async () => {
    await userService.getWelcomePageData("u");
    expect(mockRepo.findOnboardingStatus).toHaveBeenCalledWith("u");
  });

  it("getSettingsPageData parallel-fetches user + blocked users", async () => {
    mockRepo.findForSettings.mockResolvedValueOnce({ id: "u" });
    mockRepo.findBlockedUsers.mockResolvedValueOnce([{ id: "blocked_1" }]);

    const result = await userService.getSettingsPageData("u");

    expect(result).toEqual({
      user: { id: "u" },
      blockedUsers: [{ id: "blocked_1" }],
    });
    expect(mockRepo.findForSettings).toHaveBeenCalledWith("u");
    expect(mockRepo.findBlockedUsers).toHaveBeenCalledWith("u");
  });

  it("getSellerHubData delegates", async () => {
    await userService.getSellerHubData("u");
    expect(mockRepo.findForSellerHub).toHaveBeenCalledWith("u");
  });

  it("getSellerProfile delegates by username", async () => {
    await userService.getSellerProfile("alice42");
    expect(mockRepo.findPublicSellerPageData).toHaveBeenCalledWith("alice42");
  });

  it("getBlockStatus forwards both IDs", async () => {
    await userService.getBlockStatus("blocker", "blocked");
    expect(mockRepo.findBlockStatus).toHaveBeenCalledWith("blocker", "blocked");
  });

  it("getSellerBusinessInfo delegates", async () => {
    await userService.getSellerBusinessInfo("seller_1");
    expect(mockRepo.findBusinessInfo).toHaveBeenCalledWith("seller_1");
  });

  it("getMessageRecipient delegates", async () => {
    await userService.getMessageRecipient("u");
    expect(mockRepo.findForMessageRecipient).toHaveBeenCalledWith("u");
  });

  it("getEmailById delegates", async () => {
    mockRepo.findEmailById.mockResolvedValueOnce({ email: "a@b.com" });
    const result = await userService.getEmailById("u");
    expect(result).toEqual({ email: "a@b.com" });
    expect(mockRepo.findEmailById).toHaveBeenCalledWith("u");
  });
});
