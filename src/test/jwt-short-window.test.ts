// src/test/jwt-short-window.test.ts
// ─── Tests: FIX 4 — JWT 15-minute window + sliding refresh ───────────────────
//
//   1. maxAge is at most 15 minutes (900 seconds)
//   2. JWT callback rotates jti when token is older than JWT_REFRESH_THRESHOLD
//   3. Signed-out token (Redis down) is invalid within 15 minutes via natural expiry

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mocks shared by all tests ─────────────────────────────────────────────────

vi.mock("@/server/lib/jwtBlocklist", () => ({
  isTokenBlocked: vi.fn().mockResolvedValue(false),
  blockToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/lib/mfaSession", () => ({
  isMfaVerified: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/server/lib/sessionStore", () => ({
  getSessionVersion: vi.fn().mockResolvedValue(0),
  invalidateAllSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth/auth.providers", () => ({
  credentialsProvider: {},
  googleProvider: {},
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

import { JWT_MAX_AGE, JWT_REFRESH_THRESHOLD } from "@/lib/auth";
import { isTokenBlocked, blockToken } from "@/server/lib/jwtBlocklist";
import { callbacks } from "@/lib/auth/auth.callbacks";

describe("FIX 4 — JWT short window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTokenBlocked).mockResolvedValue(false);
    vi.mocked(blockToken).mockResolvedValue(undefined);
  });

  // ── 1. maxAge ──────────────────────────────────────────────────────────────

  it("JWT_MAX_AGE is at most 900 seconds (15 minutes)", () => {
    expect(JWT_MAX_AGE).toBeLessThanOrEqual(900);
    expect(JWT_MAX_AGE).toBe(15 * 60);
  });

  // ── 2. Sliding refresh — token older than threshold gets new jti ───────────

  it("rotates jti when token age exceeds JWT_REFRESH_THRESHOLD", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - JWT_REFRESH_THRESHOLD - 10;
    const originalJti = "original-jti-abc";
    const expiresAt = issuedAt + JWT_MAX_AGE;

    const result = await callbacks.jwt!({
      token: {
        sub: "user-1",
        jti: originalJti,
        sessionVersion: 0,
        iat: issuedAt,
        exp: expiresAt,
      },
      user: undefined as never,
      account: null,
      profile: undefined,
      trigger: undefined,
      isNewUser: undefined,
      session: undefined,
    });

    expect(result).not.toBeNull();
    // jti must have changed
    expect(result!.jti).toBeDefined();
    expect(result!.jti).not.toBe(originalJti);
    // Old jti must be blocklisted
    expect(blockToken).toHaveBeenCalledWith(originalJti, expiresAt);
  });

  // ── 3. Fresh token (< threshold) is NOT rotated ────────────────────────────

  it("does NOT rotate jti when token is younger than JWT_REFRESH_THRESHOLD", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 30; // 30 seconds old
    const originalJti = "fresh-jti-xyz";

    const result = await callbacks.jwt!({
      token: {
        sub: "user-1",
        jti: originalJti,
        sessionVersion: 0,
        iat: issuedAt,
        exp: issuedAt + JWT_MAX_AGE,
      },
      user: undefined as never,
      account: null,
      profile: undefined,
      trigger: undefined,
      isNewUser: undefined,
      session: undefined,
    });

    expect(result).not.toBeNull();
    expect(result!.jti).toBe(originalJti);
    expect(blockToken).not.toHaveBeenCalled();
  });

  // ── 4. Revoked token (session version bumped) becomes invalid ──────────────

  it("returns null for a signed-out user even when Redis returns stale success", async () => {
    const { getSessionVersion } = await import("@/server/lib/sessionStore");
    // Simulate sign-out: server version is higher than token version
    vi.mocked(getSessionVersion).mockResolvedValue(99);

    const result = await callbacks.jwt!({
      token: {
        sub: "user-revoked",
        jti: "revoked-jti",
        sessionVersion: 0, // token was issued before the sign-out
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + JWT_MAX_AGE,
      },
      user: undefined as never,
      account: null,
      profile: undefined,
      trigger: undefined,
      isNewUser: undefined,
      session: undefined,
    });

    // null = session invalidated; Auth.js will clear the cookie
    expect(result).toBeNull();
  });
});
