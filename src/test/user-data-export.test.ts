// src/test/user-data-export.test.ts
// ─── Unit tests for GET /api/v1/me/export ────────────────────────────────────
// NZ Privacy Act 2020 IPP 6 — personal data export (direct JSON download).

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../test/setup";
import { AppError } from "@/shared/errors";

// ── Redis mock ────────────────────────────────────────────────────────────────

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn().mockResolvedValue("OK");

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
  })),
}));

// ── Auth helper mock ──────────────────────────────────────────────────────────

vi.mock("@/app/api/v1/_helpers/response", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/api/v1/_helpers/response")>();
  return { ...actual, requireApiUser: vi.fn() };
});

// ── Export repository mock ────────────────────────────────────────────────────

vi.mock("@/modules/users/export.repository", () => ({
  exportRepository: {
    findProfile: vi.fn().mockResolvedValue({
      id: "user-abc",
      email: "user@example.co.nz",
      displayName: "Aroha Smith",
      createdAt: new Date("2024-01-01"),
    }),
    findListings: vi.fn().mockResolvedValue([]),
    findOrdersAsBuyer: vi.fn().mockResolvedValue([]),
    findOrdersAsSeller: vi.fn().mockResolvedValue([]),
    findReviewsGiven: vi.fn().mockResolvedValue([]),
    findReviewsReceived: vi.fn().mockResolvedValue([]),
    findRecentMessages: vi.fn().mockResolvedValue([]),
    findDisputes: vi.fn().mockResolvedValue([]),
  },
}));

// ── Import route handler and helpers after mocks ──────────────────────────────

const { GET } = await import("@/app/api/v1/me/export/route");
const { requireApiUser } = await import("@/app/api/v1/_helpers/response");
const { exportRepository } = await import("@/modules/users/export.repository");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: "user-abc",
  email: "user@example.co.nz",
  displayName: "Aroha Smith",
  isAdmin: false,
  isBanned: false,
  isSellerEnabled: false,
  isStripeOnboarded: false,
};

function makeGetRequest(): Request {
  return new Request("http://localhost/api/v1/me/export", { method: "GET" });
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisGet.mockResolvedValue(null); // no active cooldown by default
  mockRedisSet.mockResolvedValue("OK");

  // Reset all export repository mocks to safe defaults
  vi.mocked(exportRepository.findProfile).mockResolvedValue({
    id: "user-abc",
    email: "user@example.co.nz",
    displayName: "Aroha Smith",
    createdAt: new Date("2024-01-01"),
  } as never);
  vi.mocked(exportRepository.findListings).mockResolvedValue([]);
  vi.mocked(exportRepository.findOrdersAsBuyer).mockResolvedValue([]);
  vi.mocked(exportRepository.findOrdersAsSeller).mockResolvedValue([]);
  vi.mocked(exportRepository.findReviewsGiven).mockResolvedValue([]);
  vi.mocked(exportRepository.findReviewsReceived).mockResolvedValue([]);
  vi.mocked(exportRepository.findRecentMessages).mockResolvedValue([]);
  vi.mocked(exportRepository.findDisputes).mockResolvedValue([]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/v1/me/export", () => {
  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(requireApiUser).mockRejectedValue(AppError.unauthenticated());

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(401);
  });

  it("returns JSON with the correct Content-Disposition header", async () => {
    vi.mocked(requireApiUser).mockResolvedValue(MOCK_USER as never);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="buyzi-data-export.json"',
    );
  });

  it("response body contains profile, listings, ordersAsBuyer, and ordersAsSeller sections", async () => {
    vi.mocked(requireApiUser).mockResolvedValue(MOCK_USER as never);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toHaveProperty("profile");
    expect(body).toHaveProperty("listings");
    expect(body).toHaveProperty("ordersAsBuyer");
    expect(body).toHaveProperty("ordersAsSeller");
    expect(body).toHaveProperty("reviewsGiven");
    expect(body).toHaveProperty("reviewsReceived");
    expect(body).toHaveProperty("messages");
    expect(body).toHaveProperty("disputes");
    expect(body).toHaveProperty("exportedAt");
    expect(body).toHaveProperty("schemaVersion", "1.0");
  });

  it("strips sensitive fields from the profile in the response", async () => {
    vi.mocked(requireApiUser).mockResolvedValue(MOCK_USER as never);

    // Return a profile that includes sensitive fields — sanitizeProfile must remove them
    vi.mocked(exportRepository.findProfile).mockResolvedValue({
      id: "user-abc",
      email: "user@example.co.nz",
      displayName: "Aroha Smith",
      passwordHash: "$2b$10$sensitiveHashValue",
      stripeAccountId: "acct_1234567890abcdef",
      mfaSecret: "TOTP_SECRET",
      mfaBackupCodes: ["code1", "code2"],
      sessionVersion: 3,
      twoFactorSecret: "2FA_SECRET",
      pushTokens: ["token1"],
    } as never);

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as { profile: Record<string, unknown> };

    expect(body.profile).not.toHaveProperty("passwordHash");
    expect(body.profile).not.toHaveProperty("stripeAccountId");
    expect(body.profile).not.toHaveProperty("mfaSecret");
    expect(body.profile).not.toHaveProperty("mfaBackupCodes");
    expect(body.profile).not.toHaveProperty("sessionVersion");
    expect(body.profile).not.toHaveProperty("twoFactorSecret");
    expect(body.profile).not.toHaveProperty("pushTokens");
    // Safe fields are still present
    expect(body.profile).toHaveProperty("email");
    expect(body.profile).toHaveProperty("displayName");
  });

  it("returns 429 with EXPORT_RATE_LIMITED when a cooldown key exists in Redis", async () => {
    vi.mocked(requireApiUser).mockResolvedValue(MOCK_USER as never);
    // Simulate an existing cooldown (user already exported today)
    mockRedisGet.mockResolvedValue(new Date().toISOString());

    const res = await GET(makeGetRequest());
    const body = (await res.json()) as { code: string };

    expect(res.status).toBe(429);
    expect(body.code).toBe("EXPORT_RATE_LIMITED");
  });

  it("sets the Redis cooldown key after a successful export and blocks a second request", async () => {
    vi.mocked(requireApiUser).mockResolvedValue(MOCK_USER as never);

    // First request — no cooldown yet
    mockRedisGet.mockResolvedValue(null);
    const first = await GET(makeGetRequest());
    expect(first.status).toBe(200);

    // Verify the cooldown key was stored with a 24-hour TTL
    expect(mockRedisSet).toHaveBeenCalledOnce();
    const [key, _value, options] = mockRedisSet.mock.calls[0] as [
      string,
      string,
      { ex: number },
    ];
    expect(key).toBe(`export:cooldown:${MOCK_USER.id}`);
    expect(options).toMatchObject({ ex: 86_400 });

    // Second request — simulate cooldown now active
    mockRedisGet.mockResolvedValue(new Date().toISOString());
    const second = await GET(makeGetRequest());
    expect(second.status).toBe(429);
  });
});
