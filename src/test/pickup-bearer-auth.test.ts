// src/test/pickup-bearer-auth.test.ts
// ─── Tests: Pickup API routes pass request to requireApiUser (Bearer auth) ────
// Verifies that each pickup route calls requireApiUser(request) — not
// requireApiUser() — so mobile clients using Bearer tokens are authenticated.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock requireApiUser / checkApiRateLimit ───────────────────────────────────

const mockRequireApiUser = vi.fn();
const mockCheckApiRateLimit = vi.fn().mockResolvedValue(null);

vi.mock("@/app/api/v1/_helpers/response", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/api/v1/_helpers/response")>();
  return {
    ...actual,
    requireApiUser: mockRequireApiUser,
    checkApiRateLimit: mockCheckApiRateLimit,
  };
});

// ── Mock CORS helper ──────────────────────────────────────────────────────────

vi.mock("@/app/api/v1/_helpers/cors", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/api/v1/_helpers/cors")>();
  return {
    ...actual,
    withCors: (_res: Response) => _res,
    getCorsHeaders: () => ({}),
  };
});

// ── Mock pickup services ──────────────────────────────────────────────────────

vi.mock("@/server/services/pickup/pickup-proposal.service", () => ({
  proposePickupTime: vi.fn().mockResolvedValue({ success: true }),
  acceptPickupTime: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/server/services/pickup/pickup-cancel.service", () => ({
  cancelPickupOrder: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/server/services/pickup/pickup-reschedule.service", () => ({
  requestReschedule: vi
    .fn()
    .mockResolvedValue({ success: true, forceCancelAvailable: false }),
}));

vi.mock("@/server/services/pickup/pickup-reschedule-respond.service", () => ({
  respondToReschedule: vi.fn().mockResolvedValue({ success: true }),
}));

// ── Mock order repository (used by propose and reschedule) ────────────────────

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findParties: vi.fn().mockResolvedValue({
      buyerId: "user-1",
      sellerId: "seller-1",
    }),
  },
}));

// ── Import route handlers AFTER mocks ────────────────────────────────────────

const { POST: proposePOST } = await import("@/app/api/v1/pickup/propose/route");
const { POST: acceptPOST } = await import("@/app/api/v1/pickup/accept/route");
const { POST: cancelPOST } = await import("@/app/api/v1/pickup/cancel/route");
const { POST: reschedulePOST } =
  await import("@/app/api/v1/pickup/reschedule/route");
const { POST: rescheduleRespondPOST } =
  await import("@/app/api/v1/pickup/reschedule/respond/route");

// ── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: "user-1",
  email: "user@test.com",
  isAdmin: false,
  isBanned: false,
};

function makeRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer mock-jwt-token",
    },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pickup routes — requireApiUser receives request (Bearer auth)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckApiRateLimit.mockResolvedValue(null);
    mockRequireApiUser.mockResolvedValue(MOCK_USER);
  });

  it("propose route passes request to requireApiUser", async () => {
    const req = makeRequest("http://localhost/api/v1/pickup/propose", {
      orderId: "order-1",
      proposedTime: new Date(Date.now() + 86400000).toISOString(),
    });

    await proposePOST(req);

    expect(mockRequireApiUser).toHaveBeenCalledWith(req);
  });

  it("accept route passes request to requireApiUser", async () => {
    const req = makeRequest("http://localhost/api/v1/pickup/accept", {
      orderId: "order-1",
    });

    await acceptPOST(req);

    expect(mockRequireApiUser).toHaveBeenCalledWith(req);
  });

  it("cancel route passes request to requireApiUser", async () => {
    const req = makeRequest("http://localhost/api/v1/pickup/cancel", {
      orderId: "order-1",
      reason: "No longer available for this time",
    });

    await cancelPOST(req);

    expect(mockRequireApiUser).toHaveBeenCalledWith(req);
  });

  it("reschedule route passes request to requireApiUser", async () => {
    const req = makeRequest("http://localhost/api/v1/pickup/reschedule", {
      orderId: "order-1",
      buyerReason: "SCHEDULE_CONFLICT",
      proposedTime: new Date(Date.now() + 86400000).toISOString(),
    });

    await reschedulePOST(req);

    expect(mockRequireApiUser).toHaveBeenCalledWith(req);
  });

  it("reschedule/respond route passes request to requireApiUser", async () => {
    const req = makeRequest(
      "http://localhost/api/v1/pickup/reschedule/respond",
      {
        orderId: "order-1",
        rescheduleRequestId: "rr-1",
        response: "ACCEPT",
      },
    );

    await rescheduleRespondPOST(req);

    expect(mockRequireApiUser).toHaveBeenCalledWith(req);
  });

  it("unauthenticated request (requireApiUser throws) returns 401-like error", async () => {
    mockRequireApiUser.mockRejectedValueOnce(
      Object.assign(new Error("Unauthenticated"), {
        statusCode: 401,
        code: "UNAUTHENTICATED",
      }),
    );

    const req = makeRequest("http://localhost/api/v1/pickup/propose", {
      orderId: "order-1",
      proposedTime: new Date(Date.now() + 86400000).toISOString(),
    });

    const res = await proposePOST(req);
    // handleApiError converts AppError to JSON; status reflects the error
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("session cookie auth: requireApiUser called with request (not undefined)", async () => {
    // Same fix applies to cookie-based auth — request must be passed
    // so mobile-auth path works. Session path ignores the argument but
    // passing it is still required for the Bearer branch.
    const req = makeRequest("http://localhost/api/v1/pickup/accept", {
      orderId: "order-1",
    });

    await acceptPOST(req);

    const [passedArg] = mockRequireApiUser.mock.calls[0]!;
    expect(passedArg).toBe(req); // not undefined, not null
  });
});
