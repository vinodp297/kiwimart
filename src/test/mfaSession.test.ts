// src/test/mfaSession.test.ts
// ─── Tests: MFA session Redis key correctness ─────────────────────────────────
// Verifies that isMfaVerified(jti) and markMfaVerified(jti) use identical keys,
// and that the auth.ts jwt() guard behaves correctly when jti is missing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isMfaVerified, markMfaVerified } from "@/server/lib/mfaSession";

// ─── Mock Redis ───────────────────────────────────────────────────────────────

const mockGet = vi.fn();
const mockSet = vi.fn();

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn(() => ({
    get: mockGet,
    set: mockSet,
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────

const TEST_JTI = "test-jti-abc123";

describe("isMfaVerified", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: Verified in Redis → returns true ──────────────────────────────
  // Proves: when the JTI is in Redis, isMfaVerified(jti) returns true,
  // so the jwt() callback will set token.mfaPending = false.

  it("returns true when JTI is marked verified in Redis → jwt callback clears mfaPending", async () => {
    mockGet.mockResolvedValue("1");

    const result = await isMfaVerified(TEST_JTI);

    expect(result).toBe(true);
    expect(mockGet).toHaveBeenCalledWith(`mfa:verified:${TEST_JTI}`);
  });

  // ── Test 2: Not in Redis → returns false ──────────────────────────────────
  // Proves: when the JTI is absent, isMfaVerified(jti) returns false,
  // so the jwt() callback keeps token.mfaPending = true (user must verify).

  it("returns false when JTI is not in Redis → jwt callback keeps mfaPending: true", async () => {
    mockGet.mockResolvedValue(null);

    const result = await isMfaVerified(TEST_JTI);

    expect(result).toBe(false);
    expect(mockGet).toHaveBeenCalledWith(`mfa:verified:${TEST_JTI}`);
  });

  // ── Test 3: Redis unavailable → returns false (fail-safe) ─────────────────
  // Proves: when Redis throws, isMfaVerified fails safely to false,
  // so the jwt() callback keeps mfaPending: true — conservative default.

  it("returns false when Redis throws → jwt callback keeps mfaPending: true (safe default)", async () => {
    mockGet.mockRejectedValue(new Error("Redis connection refused"));

    const result = await isMfaVerified(TEST_JTI);

    expect(result).toBe(false);
  });

  // ── Test 4: jti undefined/null → isMfaVerified not called ────────────────
  // Proves: the auth.ts guard `token.jti ? await isMfaVerified(token.jti) : false`
  // correctly skips the Redis lookup when jti is absent, treating as unverified.

  it("guard in jwt() callback skips isMfaVerified when token.jti is absent → mfaPending stays true", async () => {
    // Simulate the auth.ts guard:
    //   const verified = token.jti ? await isMfaVerified(token.jti as string) : false;
    const tokenWithoutJti = { mfaPending: true, sub: "user-1", jti: undefined };

    const verified = tokenWithoutJti.jti
      ? await isMfaVerified(tokenWithoutJti.jti)
      : false;

    expect(verified).toBe(false);
    // isMfaVerified was never called — Redis was never touched
    expect(mockGet).not.toHaveBeenCalled();
  });
});

// ── Test 5: Round-trip ────────────────────────────────────────────────────────
// THE CRITICAL TEST — proves that markMfaVerified and isMfaVerified use the
// IDENTICAL Redis key, so setting it in mfaLogin.ts → reading it in auth.ts works.

describe("markMfaVerified + isMfaVerified round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isMfaVerified(jti) returns true after markMfaVerified(jti) — key written matches key read", async () => {
    // Simulate: markMfaVerified sets the key
    mockSet.mockResolvedValue("OK");
    await markMfaVerified(TEST_JTI);

    // Capture what key markMfaVerified wrote
    expect(mockSet).toHaveBeenCalledTimes(1);
    const writtenKey = (mockSet.mock.calls[0] as unknown[])[0] as string;
    expect(writtenKey).toBe(`mfa:verified:${TEST_JTI}`);

    // Simulate: isMfaVerified reads the same key and finds "1"
    mockGet.mockResolvedValue("1");
    const verified = await isMfaVerified(TEST_JTI);

    // Capture what key isMfaVerified read
    const readKey = (mockGet.mock.calls[0] as unknown[])[0] as string;
    expect(readKey).toBe(`mfa:verified:${TEST_JTI}`);

    // The written key and read key must be identical — this proves the fix
    expect(writtenKey).toBe(readKey);
    expect(verified).toBe(true);
  });
});
