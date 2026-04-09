// src/test/token-refresh-revoke.test.ts
// ─── Tests: mobile token refresh revokes old token ───────────────────────────
// Verifies that after a successful refresh the old token is revoked via:
//   1. revokeMobileToken (primary — deletes Redis key checked by verifyMobileToken)
//   2. blockToken (defence-in-depth — JWT blocklist with remaining TTL)

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock mobile-auth ──────────────────────────────────────────────────────────

const mockVerifyMobileToken = vi.fn();
const mockSignMobileToken = vi.fn();
const mockRevokeMobileToken = vi.fn();

vi.mock("@/lib/mobile-auth", () => ({
  verifyMobileToken: (...args: unknown[]) => mockVerifyMobileToken(...args),
  signMobileToken: (...args: unknown[]) => mockSignMobileToken(...args),
  revokeMobileToken: (...args: unknown[]) => mockRevokeMobileToken(...args),
}));

// ── Mock JWT blocklist ────────────────────────────────────────────────────────

const mockBlockToken = vi.fn();

vi.mock("@/server/lib/jwtBlocklist", () => ({
  blockToken: (...args: unknown[]) => mockBlockToken(...args),
  isTokenBlocked: vi.fn().mockResolvedValue(false),
}));

// ── Import route after mocks ──────────────────────────────────────────────────

const { POST } = await import("@/app/api/v1/auth/refresh/route");

// ── Helpers ──────────────────────────────────────────────────────────────────

const OLD_JTI = "old-jti-abc123";
const NEW_JTI = "new-jti-xyz789";
const USER_ID = "user-refresh-test";
const OLD_EXP = Math.floor(Date.now() / 1000) + 3600; // expires in 1 hour

function makeOldPayload() {
  return {
    sub: USER_ID,
    email: "user@test.com",
    role: "user",
    jti: OLD_JTI,
    exp: OLD_EXP,
    iat: Math.floor(Date.now() / 1000) - 86400,
  };
}

function makeRefreshRequest(token = "old-bearer-token") {
  return new Request("http://localhost/api/v1/auth/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("mobile token refresh — old token revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyMobileToken.mockResolvedValue(makeOldPayload());
    mockSignMobileToken.mockResolvedValue({
      token: "new-jwt-token",
      expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
    });
    mockRevokeMobileToken.mockResolvedValue(undefined);
    mockBlockToken.mockResolvedValue(undefined);
  });

  it("issues a new token on successful refresh", async () => {
    const res = await POST(makeRefreshRequest());
    const body = (await res.json()) as {
      success: boolean;
      data: { token: string };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.token).toBe("new-jwt-token");
  });

  it("revokes old token via revokeMobileToken after issuing new token", async () => {
    await POST(makeRefreshRequest());

    expect(mockRevokeMobileToken).toHaveBeenCalledWith(USER_ID, OLD_JTI);
  });

  it("adds old JTI to JWT blocklist with old token exp", async () => {
    await POST(makeRefreshRequest());

    expect(mockBlockToken).toHaveBeenCalledWith(OLD_JTI, OLD_EXP);
  });

  it("old and new JTI are different — new token has independent identity", async () => {
    // signMobileToken is called once with new credentials; verifyMobileToken
    // received the old payload. Verify we didn't accidentally blocklist new JTI.
    await POST(makeRefreshRequest());

    // blockToken should be called with OLD_JTI, not with a new JTI
    const [calledJti] = mockBlockToken.mock.calls[0]!;
    expect(calledJti).toBe(OLD_JTI);
    // revokeMobileToken should use OLD_JTI too
    const [, revokedJti] = mockRevokeMobileToken.mock.calls[0]!;
    expect(revokedJti).toBe(OLD_JTI);
  });

  it("returns 401 when token is invalid (no revocation attempted)", async () => {
    mockVerifyMobileToken.mockResolvedValue(null);

    const res = await POST(makeRefreshRequest("invalid-token"));
    const body = (await res.json()) as { success: boolean; code: string };

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(mockRevokeMobileToken).not.toHaveBeenCalled();
    expect(mockBlockToken).not.toHaveBeenCalled();
  });
});
