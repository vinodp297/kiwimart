// src/test/account-delete-rate-limit.test.ts
// ─── Tests: Account deletion rate limiting ────────────────────────────────────
// Verifies the rate limiting added to POST /api/v1/account/delete:
//
//   1. Account deletion succeeds within rate limit
//   2. Account deletion is blocked after 5 attempts → 429 RATE_LIMITED
//   3. Rate limit key is user-ID-based (contains userId, not IP)
//   4. Different users have independent rate limit counters

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const {
  mockRequireApiUser,
  mockVerifyPassword,
  mockFindPasswordHash,
  mockRateLimit,
  mockPerformAccountErasure,
} = vi.hoisted(() => ({
  mockRequireApiUser: vi.fn(),
  mockVerifyPassword: vi.fn(),
  mockFindPasswordHash: vi.fn(),
  mockRateLimit: vi.fn(),
  mockPerformAccountErasure: vi.fn(),
}));

vi.mock("@/app/api/v1/_helpers/response", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/api/v1/_helpers/response")>();
  return {
    ...actual,
    requireApiUser: () => mockRequireApiUser(),
  };
});

vi.mock("@/app/api/v1/_helpers/cors", () => ({
  withCors: (res: Response) => res,
  getCorsHeaders: () => ({}),
}));

vi.mock("@/server/lib/rateLimit", () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/server/lib/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("$argon2id$hashed"),
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}));

vi.mock("@/modules/users/user.repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/users/user.repository")>();
  return {
    ...actual,
    userRepository: {
      ...(actual.userRepository as object),
      findPasswordHash: (...args: unknown[]) => mockFindPasswordHash(...args),
      findEmailInfo: vi.fn().mockResolvedValue(null),
    },
  };
});

vi.mock("@/modules/users/erasure.service", () => ({
  performAccountErasure: (...args: unknown[]) =>
    mockPerformAccountErasure(...args),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────
import { POST } from "@/app/api/v1/account/delete/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USER_A = { id: "user-rl-test-a", email: "a@buyzi.test", isAdmin: false };
const USER_B = { id: "user-rl-test-b", email: "b@buyzi.test", isAdmin: false };

function makeDeleteRequest(
  body: Record<string, unknown> = { password: "Correct1!" },
) {
  return new Request("http://localhost/api/v1/account/delete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const RATE_LIMIT_ALLOWED = {
  success: true,
  remaining: 4,
  reset: Date.now() + 3600_000,
  retryAfter: 0,
};

const RATE_LIMIT_EXCEEDED = {
  success: false,
  remaining: 0,
  reset: Date.now() + 3600_000,
  retryAfter: 3600,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/v1/account/delete — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiUser.mockResolvedValue(USER_A);
    mockVerifyPassword.mockResolvedValue(true);
    mockFindPasswordHash.mockResolvedValue({ passwordHash: "$argon2id$hash" });
    mockRateLimit.mockResolvedValue(RATE_LIMIT_ALLOWED);
    mockPerformAccountErasure.mockResolvedValue({
      erasureLogId: "log-1",
      anonymisedEmail: `deleted_${USER_A.id}@buyzi.deleted`,
    });
  });

  // Test 1 — Succeeds within rate limit
  it("account deletion succeeds when within rate limit", async () => {
    const res = await POST(makeDeleteRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  // Test 2 — Blocked after limit exceeded → 429 RATE_LIMITED
  it("returns 429 RATE_LIMITED when rate limit is exceeded", async () => {
    mockRateLimit.mockResolvedValue(RATE_LIMIT_EXCEEDED);

    const res = await POST(makeDeleteRequest());
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("RATE_LIMITED");
  });

  // Test 2b — erasure is NOT performed when rate limited
  it("does not call performAccountErasure when rate limited", async () => {
    mockRateLimit.mockResolvedValue(RATE_LIMIT_EXCEEDED);

    await POST(makeDeleteRequest());

    expect(mockPerformAccountErasure).not.toHaveBeenCalled();
  });

  // Test 3 — Rate limit key is user-ID-based (contains userId, not IP)
  it("rate limit key contains the user ID, not the IP address", async () => {
    await POST(makeDeleteRequest());

    expect(mockRateLimit).toHaveBeenCalledWith(
      "accountDelete",
      expect.stringContaining(USER_A.id),
    );

    // Key format must be account-delete:{userId}
    const [, keyArg] = mockRateLimit.mock.calls[0]!;
    expect(keyArg).toBe(`account-delete:${USER_A.id}`);
  });

  // Test 4 — Different users have independent rate limit counters
  it("different users have independent rate limit counters", async () => {
    // User A's request
    mockRequireApiUser.mockResolvedValueOnce(USER_A);
    await POST(makeDeleteRequest());
    const keyForA = mockRateLimit.mock.calls[0]![1] as string;

    // User B's request
    mockRequireApiUser.mockResolvedValueOnce(USER_B);
    await POST(makeDeleteRequest());
    const keyForB = mockRateLimit.mock.calls[1]![1] as string;

    expect(keyForA).toContain(USER_A.id);
    expect(keyForB).toContain(USER_B.id);
    expect(keyForA).not.toBe(keyForB);
  });

  // Test 4b — Verifies the "accountDelete" limiter type is used
  it("uses the accountDelete rate limiter type", async () => {
    await POST(makeDeleteRequest());

    expect(mockRateLimit).toHaveBeenCalledWith(
      "accountDelete",
      expect.any(String),
    );
  });
});
