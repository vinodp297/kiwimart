// src/test/user-erasure.test.ts
// ─── Unit tests for POST /api/v1/me/erase and GET /api/v1/me/erase/confirm ───
// NZ Privacy Act 2020 — two-step email-confirmation erasure flow.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../test/setup";
import { AppError } from "@/shared/errors";

// ── Redis mock ────────────────────────────────────────────────────────────────

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn().mockResolvedValue("OK");
const mockRedisDel = vi.fn().mockResolvedValue(1);

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: vi.fn(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  })),
}));

// ── Auth helper mock ──────────────────────────────────────────────────────────

vi.mock("@/app/api/v1/_helpers/response", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/api/v1/_helpers/response")>();
  return { ...actual, requireApiUser: vi.fn() };
});

// ── Order repository mock ─────────────────────────────────────────────────────

vi.mock("@/modules/orders/order.repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/orders/order.repository")>();
  return {
    ...actual,
    orderRepository: {
      ...(actual.orderRepository as object),
      countActiveOrdersForUser: vi.fn().mockResolvedValue(0),
    },
  };
});

// ── User repository mock ──────────────────────────────────────────────────────

vi.mock("@/modules/users/user.repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/users/user.repository")>();
  return {
    ...actual,
    userRepository: {
      ...(actual.userRepository as object),
      findEmailInfo: vi.fn().mockResolvedValue({
        email: "user@example.co.nz",
        displayName: "Aroha Smith",
      }),
      findEmailVerified: vi.fn().mockResolvedValue({
        emailVerified: new Date("2025-01-01"),
      }),
    },
  };
});

// ── Erasure service mock ──────────────────────────────────────────────────────

vi.mock("@/modules/users/erasure.service", () => ({
  performAccountErasure: vi
    .fn()
    .mockResolvedValue({
      erasureLogId: "log-1",
      anonymisedEmail: "deleted@buyzi.deleted",
    }),
}));

// ── Import route handlers after mocks ────────────────────────────────────────

const { POST } = await import("@/app/api/v1/me/erase/route");
const { GET: confirmGET } = await import("@/app/api/v1/me/erase/confirm/route");
const { requireApiUser } = await import("@/app/api/v1/_helpers/response");
const { enqueueEmail } = await import("@/lib/email-queue");
const { orderRepository } = await import("@/modules/orders/order.repository");
const { performAccountErasure } =
  await import("@/modules/users/erasure.service");

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

function makePostRequest(): Request {
  return new Request("http://localhost/api/v1/me/erase", { method: "POST" });
}

function makeConfirmRequest(token: string): Request {
  return new Request(`http://localhost/api/v1/me/erase/confirm?token=${token}`);
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue("OK");
  mockRedisDel.mockResolvedValue(1);
});

// ── POST /api/v1/me/erase ────────────────────────────────────────────────────

describe("POST /api/v1/me/erase", () => {
  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(requireApiUser).mockRejectedValue(AppError.unauthenticated());

    const res = await POST(makePostRequest());

    expect(res.status).toBe(401);
  });

  it("returns 200 and enqueues an erasureRequest email when the request is valid", async () => {
    vi.mocked(requireApiUser).mockResolvedValue(MOCK_USER as never);
    vi.mocked(orderRepository.countActiveOrdersForUser).mockResolvedValue(0);

    const res = await POST(makePostRequest());

    expect(res.status).toBe(200);
    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledOnce();
    expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ template: "erasureRequest" }),
    );
  });

  it("returns 409 when the user has active orders in escrow", async () => {
    vi.mocked(requireApiUser).mockResolvedValue(MOCK_USER as never);
    vi.mocked(orderRepository.countActiveOrdersForUser).mockResolvedValue(2);

    const res = await POST(makePostRequest());
    const body = (await res.json()) as { code: string };

    expect(res.status).toBe(409);
    expect(body.code).toBe("ERASURE_BLOCKED");
  });

  it("stores the token in Redis with a 24-hour TTL", async () => {
    vi.mocked(requireApiUser).mockResolvedValue(MOCK_USER as never);
    vi.mocked(orderRepository.countActiveOrdersForUser).mockResolvedValue(0);

    await POST(makePostRequest());

    expect(mockRedisSet).toHaveBeenCalledOnce();
    const [key, _value, options] = mockRedisSet.mock.calls[0] as [
      string,
      string,
      { ex: number },
    ];
    expect(key).toMatch(/^erasure:token:/);
    expect(options).toMatchObject({ ex: 86_400 });
  });
});

// ── GET /api/v1/me/erase/confirm ─────────────────────────────────────────────

describe("GET /api/v1/me/erase/confirm", () => {
  it("redirects to /?erased=invalid when no token is provided", async () => {
    const req = new Request("http://localhost/api/v1/me/erase/confirm");
    const res = await confirmGET(req);

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain("erased=invalid");
  });

  it("redirects to /?erased=invalid when the token is not found in Redis", async () => {
    mockRedisGet.mockResolvedValue(null);

    const res = await confirmGET(makeConfirmRequest("unknowntoken123"));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain("erased=invalid");
  });

  it("calls performAccountErasure with the userId stored in Redis", async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: "user-abc" }));

    await confirmGET(makeConfirmRequest("validtoken123"));

    expect(vi.mocked(performAccountErasure)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-abc",
        operatorId: "self-service",
      }),
    );
  });

  it("deletes the Redis key after a successful erasure (prevents replay)", async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: "user-abc" }));

    await confirmGET(makeConfirmRequest("validtoken123"));

    expect(mockRedisDel).toHaveBeenCalledWith("erasure:token:validtoken123");
  });

  it("redirects to /?erased=true after a successful erasure", async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: "user-abc" }));

    const res = await confirmGET(makeConfirmRequest("validtoken123"));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain("erased=true");
  });
});
