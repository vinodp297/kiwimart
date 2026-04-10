// src/test/export-cooldown.test.ts
// ─── Tests: Export cooldown — enqueue failure must NOT set rate-limit key ──────
// Fix 1 regression guard:
//   • Successful enqueue → cooldown set, success returned
//   • Failed enqueue    → cooldown NOT set, error propagated
//   • After failed enqueue the user can retry immediately (no cooldown blocking)

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Captured Redis mock — must be module-level so vi.mock factory can close over it ──
const mockRedisGet = vi.fn().mockResolvedValue(null); // not rate-limited by default
const mockRedisSet = vi.fn().mockResolvedValue("OK");

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    get: mockRedisGet,
    set: mockRedisSet,
    ping: vi.fn().mockResolvedValue("PONG"),
  }),
}));

// ── Other dependencies ────────────────────────────────────────────────────────
import db from "@/lib/db";
import { r2 } from "@/infrastructure/storage/r2";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { enqueueEmail } from "@/lib/email-queue";
import { exportUserData } from "@/modules/users/export.service";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = "user-cooldown-test-1";
const USER_EMAIL = "cooldown@buyzi.test";

const MOCK_PROFILE = {
  id: USER_ID,
  email: USER_EMAIL,
  username: "cooldownuser",
  displayName: "Cooldown User",
  bio: null,
  phone: null,
  isPhoneVerified: false,
  region: "Auckland",
  suburb: null,
  dateOfBirth: null,
  idVerified: false,
  nzbn: null,
  gstNumber: null,
  isSellerEnabled: false,
  hasMarketingConsent: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SIGNED_URL =
  "https://test-bucket.r2.example.com/exports/cooldown-signed?X-Amz-Signature=xyz";

function setupDefaultMocks() {
  mockRedisGet.mockResolvedValue(null); // not rate-limited
  mockRedisSet.mockResolvedValue("OK");

  vi.mocked(db.user.findUnique).mockResolvedValue(MOCK_PROFILE as never);
  vi.mocked(db.order.findMany).mockResolvedValue([]);
  vi.mocked(db.message.findMany).mockResolvedValue([]);
  vi.mocked(db.review.findMany).mockResolvedValue([]);
  vi.mocked(db.listing.findMany).mockResolvedValue([]);
  vi.mocked(db.offer.findMany).mockResolvedValue([]);
  vi.mocked(db.watchlistItem.findMany).mockResolvedValue([]);

  vi.mocked(r2.send).mockResolvedValue({} as never);
  vi.mocked(getSignedUrl).mockResolvedValue(SIGNED_URL);
  vi.mocked(enqueueEmail).mockResolvedValue(undefined);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("exportUserData — cooldown gate (Fix 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // Test 1: Successful enqueue → cooldown set and function resolves
  it("sets the 30-day cooldown in Redis after a successful enqueue", async () => {
    await exportUserData(USER_ID, USER_EMAIL);

    // Redis set must have been called with the rate-limit key
    expect(mockRedisSet).toHaveBeenCalledWith(
      `data_export:${USER_ID}`,
      expect.any(String),
      expect.objectContaining({ ex: expect.any(Number) }),
    );

    // The TTL must be 30 days (30 × 86 400 = 2 592 000 seconds)
    const setCall = mockRedisSet.mock.calls[0]!;
    const opts = setCall[2] as { ex: number };
    expect(opts.ex).toBe(30 * 86_400);
  });

  // Test 2: Failed enqueue → cooldown NOT set, error propagated
  it("does NOT set the 30-day cooldown when email enqueuing fails", async () => {
    const queueError = new Error("BullMQ queue unreachable");
    vi.mocked(enqueueEmail).mockRejectedValueOnce(queueError);

    await expect(exportUserData(USER_ID, USER_EMAIL)).rejects.toThrow(
      "BullMQ queue unreachable",
    );

    // The rate-limit key must NOT have been written — user can retry
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  // Test 3: After a failed enqueue the user is not blocked (no cooldown set)
  it("allows a retry immediately after a failed enqueue (no cooldown blocking)", async () => {
    // First attempt — enqueue fails
    vi.mocked(enqueueEmail).mockRejectedValueOnce(new Error("Queue down"));

    await expect(exportUserData(USER_ID, USER_EMAIL)).rejects.toThrow();

    // Confirm no cooldown was written
    expect(mockRedisSet).not.toHaveBeenCalled();

    // Simulate second attempt — Redis still returns null (no cooldown exists)
    // (mockRedisGet already returns null by default from setupDefaultMocks)
    vi.mocked(enqueueEmail).mockResolvedValueOnce(undefined);

    // Second call must succeed without an EXPORT_RATE_LIMITED error
    await expect(exportUserData(USER_ID, USER_EMAIL)).resolves.toBeUndefined();

    // Cooldown is now set after the successful second attempt
    expect(mockRedisSet).toHaveBeenCalledOnce();
  });
});
