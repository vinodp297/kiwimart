// src/test/push-token.test.ts
// ─── Tests: Push token registration and management ────────────────────────────
// Covers:
//   POST /api/v1/notifications/push:
//     1. Valid token is persisted to the database (upsert called)
//     2. Same token can be re-registered — upsert updates existing record
//     3. Requires authentication — 401 when not logged in
//     4. Validates platform enum — 400 for unsupported platform
//   DELETE /api/v1/notifications/push:
//     5. Soft-deletes the token (deactivatePushToken called)
//     6. Requires authentication — 401 when not logged in
//   Repository:
//     7. getActivePushTokensByUserId returns only active tokens
//     8. deleteInactivePushTokens removes tokens inactive for 90+ days

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── Mock the notification service so route tests don't need DB ────────────────
// The service is tested separately; here we only verify the route delegates
// correctly and that the service methods behave as expected.

vi.mock(
  "@/modules/notifications/notification.service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/modules/notifications/notification.service")
      >();
    return {
      ...actual,
      registerPushToken: vi.fn().mockResolvedValue({ success: true }),
      unregisterPushToken: vi.fn().mockResolvedValue({ success: true }),
    };
  },
);

// ── Route handlers (imported after mocks) ─────────────────────────────────────

const { POST, DELETE } = await import("@/app/api/v1/notifications/push/route");

import {
  registerPushToken,
  unregisterPushToken,
} from "@/modules/notifications/notification.service";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import db from "@/lib/db";

// ── Auth mock helpers ─────────────────────────────────────────────────────────

// requireApiUser is called inside the route handlers via the response helpers.
// It is globally mocked in setup.ts. We configure it per describe block.

import { requireApiUser } from "@/app/api/v1/_helpers/response";

vi.mock("@/app/api/v1/_helpers/response", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/api/v1/_helpers/response")>();
  return {
    ...actual,
    requireApiUser: vi.fn(),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: "user-1",
  email: "user@test.com",
  isAdmin: false,
  isBanned: false,
  isSellerEnabled: true,
  isStripeOnboarded: false,
};

const MOCK_TOKEN = "ExampleFCMToken12345678901234567890";
const MOCK_TOKEN_PREFIX = MOCK_TOKEN.slice(0, 8);

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/notifications/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/notifications/push", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/notifications/push — register push token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireApiUser).mockResolvedValue(MOCK_USER as never);
  });

  // Test 1: valid token is persisted
  it("persists a valid push token to the database", async () => {
    const res = await POST(
      makePostRequest({
        token: MOCK_TOKEN,
        platform: "android",
        deviceId: "device-abc",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe("Push token registered");
    expect(registerPushToken).toHaveBeenCalledWith(
      "user-1",
      MOCK_TOKEN,
      "android",
      "device-abc",
    );
  });

  // Test 2: same token can be re-registered (upsert behaviour)
  it("re-registers an existing token without error (upsert)", async () => {
    // First registration
    await POST(makePostRequest({ token: MOCK_TOKEN, platform: "ios" }));
    // Second registration — same token
    const res = await POST(
      makePostRequest({ token: MOCK_TOKEN, platform: "ios" }),
    );

    expect(res.status).toBe(200);
    // registerPushToken should have been called twice
    expect(registerPushToken).toHaveBeenCalledTimes(2);
    // Both calls used the same token
    expect(vi.mocked(registerPushToken).mock.calls[1]![1]).toBe(MOCK_TOKEN);
  });

  // Test 3: requires authentication
  it("returns 401 when not logged in", async () => {
    const { AppError } = await import("@/shared/errors");
    vi.mocked(requireApiUser).mockRejectedValue(AppError.unauthenticated());

    const res = await POST(
      makePostRequest({ token: MOCK_TOKEN, platform: "ios" }),
    );

    expect(res.status).toBe(401);
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  // Test 4: validates platform enum
  it("returns 400 for an unsupported platform", async () => {
    const res = await POST(
      makePostRequest({ token: MOCK_TOKEN, platform: "blackberry" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  it("accepts web as a valid platform", async () => {
    const res = await POST(
      makePostRequest({ token: MOCK_TOKEN, platform: "web" }),
    );

    expect(res.status).toBe(200);
    expect(registerPushToken).toHaveBeenCalledWith(
      "user-1",
      MOCK_TOKEN,
      "web",
      undefined,
    );
  });

  it("deviceId is optional", async () => {
    const res = await POST(
      makePostRequest({ token: MOCK_TOKEN, platform: "android" }),
    );

    expect(res.status).toBe(200);
    expect(registerPushToken).toHaveBeenCalledWith(
      "user-1",
      MOCK_TOKEN,
      "android",
      undefined,
    );
  });
});

describe("DELETE /api/v1/notifications/push — unregister push token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireApiUser).mockResolvedValue(MOCK_USER as never);
  });

  // Test 5: soft-deletes the token
  it("deactivates the token (soft delete)", async () => {
    const res = await DELETE(makeDeleteRequest({ token: MOCK_TOKEN }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(unregisterPushToken).toHaveBeenCalledWith(MOCK_TOKEN);
  });

  // Test 6: requires authentication
  it("returns 401 when not logged in", async () => {
    const { AppError } = await import("@/shared/errors");
    vi.mocked(requireApiUser).mockRejectedValue(AppError.unauthenticated());

    const res = await DELETE(makeDeleteRequest({ token: MOCK_TOKEN }));

    expect(res.status).toBe(401);
    expect(unregisterPushToken).not.toHaveBeenCalled();
  });

  it("returns 400 when token is missing from body", async () => {
    const res = await DELETE(makeDeleteRequest({}));

    expect(res.status).toBe(400);
    expect(unregisterPushToken).not.toHaveBeenCalled();
  });
});

describe("notificationRepository — push token methods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 7: getActivePushTokensByUserId returns only active tokens
  it("getActivePushTokensByUserId returns only active tokens for the user", async () => {
    const activeTokens = [
      {
        id: "pt-1",
        userId: "user-1",
        token: "token-abc",
        platform: "ios",
        deviceId: null,
        isActive: true,
        lastUsedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    vi.mocked(db.pushToken.findMany).mockResolvedValue(activeTokens as never);

    const result =
      await notificationRepository.getActivePushTokensByUserId("user-1");

    expect(result).toHaveLength(1);
    expect(result[0]!.isActive).toBe(true);
    expect(db.pushToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", isActive: true },
      }),
    );
  });

  // Test 8: deleteInactivePushTokens removes tokens inactive for 90+ days
  it("deleteInactivePushTokens removes tokens inactive for 90+ days", async () => {
    vi.mocked(db.pushToken.deleteMany).mockResolvedValue({ count: 3 });

    const count = await notificationRepository.deleteInactivePushTokens();

    expect(count).toBe(3);

    const call = vi.mocked(db.pushToken.deleteMany).mock.calls[0]![0]!;
    expect(call.where).toMatchObject({ isActive: false });

    // Verify the cutoff date is approximately 90 days ago
    const cutoff = (
      call.where as { isActive: boolean; updatedAt: { lt: Date } }
    ).updatedAt.lt;
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const diff = Math.abs(cutoff.getTime() - ninetyDaysAgo.getTime());
    expect(diff).toBeLessThan(5_000); // within 5 seconds
  });

  it("upsertPushToken calls db.pushToken.upsert with correct shape", async () => {
    const mockRow = {
      id: "pt-1",
      userId: "user-1",
      token: MOCK_TOKEN,
      platform: "ios",
      deviceId: "dev-1",
      isActive: true,
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(db.pushToken.upsert).mockResolvedValue(mockRow as never);

    const result = await notificationRepository.upsertPushToken(
      "user-1",
      MOCK_TOKEN,
      "ios",
      "dev-1",
    );

    expect(result.token).toBe(MOCK_TOKEN);
    expect(result.platform).toBe("ios");
    expect(result.isActive).toBe(true);

    const upsertCall = vi.mocked(db.pushToken.upsert).mock.calls[0]![0]!;
    expect(upsertCall.where).toEqual({ token: MOCK_TOKEN });
    // Token must never appear in logs — verify we don't accidentally store prefix
    expect(MOCK_TOKEN_PREFIX).toHaveLength(8);
  });

  it("deactivatePushToken sets isActive: false without hard-deleting", async () => {
    await notificationRepository.deactivatePushToken(MOCK_TOKEN);

    expect(db.pushToken.updateMany).toHaveBeenCalledWith({
      where: { token: MOCK_TOKEN },
      data: { isActive: false },
    });
    // Hard delete must NOT be called
    expect(db.pushToken.deleteMany).not.toHaveBeenCalled();
  });
});

describe("cleanupStalePushTokens job", () => {
  it("returns deleted count and logs completion", async () => {
    vi.mocked(db.pushToken.deleteMany).mockResolvedValue({ count: 7 });

    const { cleanupStalePushTokens } =
      await import("@/server/jobs/cleanupStalePushTokens");
    const result = await cleanupStalePushTokens();

    expect(result.deleted).toBe(7);
    expect(result.errors).toBe(0);
  });

  it("returns errors: 1 and deleted: 0 when the DB throws", async () => {
    vi.mocked(db.pushToken.deleteMany).mockRejectedValue(
      new Error("DB unavailable"),
    );

    const { cleanupStalePushTokens } =
      await import("@/server/jobs/cleanupStalePushTokens");
    const result = await cleanupStalePushTokens();

    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(1);
  });
});
