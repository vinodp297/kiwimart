// src/test/verification.actions.test.ts
// ─── Tests: Phone Verification Server Actions ───────────────────────────────
// Covers requestPhoneVerification (rate-limited code send) and
// verifyPhoneCode (code confirmation).

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock userService ─────────────────────────────────────────────────────────
const mockRequestPhoneVerification = vi.fn();
const mockVerifyPhoneCode = vi.fn();
vi.mock("@/modules/users/user.service", () => ({
  userService: {
    requestPhoneVerification: (...args: unknown[]) =>
      mockRequestPhoneVerification(...args),
    verifyPhoneCode: (...args: unknown[]) => mockVerifyPhoneCode(...args),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { requestPhoneVerification, verifyPhoneCode } =
  await import("@/server/actions/verification");
const { rateLimit } = await import("@/server/lib/rateLimit");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER = {
  id: "user_phone",
  email: "p@test.com",
  isAdmin: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// requestPhoneVerification
// ─────────────────────────────────────────────────────────────────────────────

describe("requestPhoneVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockRequestPhoneVerification.mockResolvedValue({
      expiresAt: "2026-04-16T10:05:00.000Z",
    });
  });

  it("unauthenticated → returns safe error (no service call)", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await requestPhoneVerification({ phone: "+64211234567" });

    expect(result.success).toBe(false);
    expect(mockRequestPhoneVerification).not.toHaveBeenCalled();
  });

  it("rate limit exceeded → returns too many requests error", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 3_600_000,
      retryAfter: 3600,
    });

    const result = await requestPhoneVerification({ phone: "+64211234567" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many|wait/i);
    }
    expect(mockRequestPhoneVerification).not.toHaveBeenCalled();
  });

  it("rate limit scoped to phone-verify:{userId}", async () => {
    await requestPhoneVerification({ phone: "+64211234567" });

    expect(vi.mocked(rateLimit)).toHaveBeenCalledWith(
      "auth",
      `phone-verify:${TEST_USER.id}`,
    );
  });

  it("happy path → delegates user id, phone, ip and returns expiresAt", async () => {
    const result = await requestPhoneVerification({ phone: "+64211234567" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresAt).toBe("2026-04-16T10:05:00.000Z");
    }
    expect(mockRequestPhoneVerification).toHaveBeenCalledWith(
      TEST_USER.id,
      "+64211234567",
      expect.any(String), // ip from mocked getClientIp
    );
  });

  it("service throws → returns safe fallback error (no leak)", async () => {
    mockRequestPhoneVerification.mockRejectedValueOnce(
      new Error("Twilio 500: boom"),
    );

    const result = await requestPhoneVerification({ phone: "+64211234567" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
      expect(result.error).not.toMatch(/Twilio|boom/);
    }
  });

  it("different phone format passes through unchanged", async () => {
    await requestPhoneVerification({ phone: "021 234 5678" });

    expect(mockRequestPhoneVerification).toHaveBeenCalledWith(
      TEST_USER.id,
      "021 234 5678",
      expect.any(String),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyPhoneCode
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyPhoneCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockVerifyPhoneCode.mockResolvedValue(undefined);
  });

  it("unauthenticated → returns safe error (no service call)", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await verifyPhoneCode({ code: "123456" });

    expect(result.success).toBe(false);
    expect(mockVerifyPhoneCode).not.toHaveBeenCalled();
  });

  it("happy path → delegates user id, code, ip", async () => {
    const result = await verifyPhoneCode({ code: "123456" });

    expect(result.success).toBe(true);
    expect(mockVerifyPhoneCode).toHaveBeenCalledWith(
      TEST_USER.id,
      "123456",
      expect.any(String),
    );
  });

  it("service throws (wrong code) → returns safe fallback error", async () => {
    mockVerifyPhoneCode.mockRejectedValueOnce(new Error("Invalid code"));

    const result = await verifyPhoneCode({ code: "000000" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  it("forwards different codes unchanged", async () => {
    await verifyPhoneCode({ code: "987654" });

    expect(mockVerifyPhoneCode).toHaveBeenCalledWith(
      TEST_USER.id,
      "987654",
      expect.any(String),
    );
  });

  it("does not leak raw DB error details", async () => {
    mockVerifyPhoneCode.mockRejectedValueOnce(
      new Error("ECONNREFUSED 127.0.0.1:5432"),
    );

    const result = await verifyPhoneCode({ code: "123456" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
    }
  });
});
