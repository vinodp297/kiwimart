// src/test/image-proxy-auth.test.ts
// ─── Image Proxy Prefix-Based Authorisation ──────────────────────────────────
//
// Tests that /api/images/[...key] enforces correct access control per prefix:
//
//   1.  Public listing image served without auth (200)
//   2.  Public avatar/profile image served without auth (200)
//   3.  Dispute image — unauthenticated returns 401
//   4.  Dispute image — authenticated non-party returns 403
//   5.  Dispute image — authenticated buyer returns 200
//   6.  Dispute image — authenticated seller returns 200
//   7.  Dispute image — authenticated admin returns 200
//   8.  Export file — owner returns 200
//   9.  Export file — different user returns 403
//  10.  KYC (verification) file — admin returns 200
//  11.  KYC (verification) file — non-admin authenticated user returns 403
//  12.  Unknown prefix — returns 404

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mock auth() ─────────────────────────────────────────────────────────────
const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
}));

// ─── Mock orderRepository ────────────────────────────────────────────────────
const mockIsUserPartyToOrder = vi.fn();
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    isUserPartyToOrder: (...a: unknown[]) => mockIsUserPartyToOrder(...a),
  },
}));

// ─── Mock R2 ─────────────────────────────────────────────────────────────────
const mockR2Send = vi.fn();
vi.mock("@/infrastructure/storage/r2", () => ({
  r2: { send: (...a: unknown[]) => mockR2Send(...a) },
  R2_BUCKET: "test-bucket",
}));

// ─── Mock AWS SDK ─────────────────────────────────────────────────────────────
vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class GetObjectCommand {
    constructor(p: unknown) {
      Object.assign(this, p);
    }
  },
}));

// ─── Import handler after mocks ───────────────────────────────────────────────
import { GET } from "@/app/api/images/[...key]/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/images/${path}`);
}

function makeParams(segments: string[]): {
  params: Promise<{ key: string[] }>;
} {
  return { params: Promise.resolve({ key: segments }) };
}

/** Minimal async-iterable body for the R2 mock response. */
function makeBody(content = "image-bytes") {
  const buf = Buffer.from(content);
  return {
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
  };
}

function successR2Response() {
  mockR2Send.mockResolvedValue({
    Body: makeBody(),
    ContentType: "image/webp",
  });
}

const BUYER_ID = "buyer-user-id";
const SELLER_ID = "seller-user-id";
const OTHER_ID = "other-user-id";
const ADMIN_ID = "admin-user-id";
const ORDER_ID = "order-abc-123";

function sessionFor(
  userId: string,
  isAdmin = false,
): { user: { id: string; isAdmin: boolean } } {
  return { user: { id: userId, isAdmin } };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("Image Proxy — prefix-based authorisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: unauthenticated
    mockAuth.mockResolvedValue(null);
    // Default: not a party
    mockIsUserPartyToOrder.mockResolvedValue(false);
  });

  // ── Test 1: Public listing image — no auth required ───────────────────────
  it("serves a public listing image without authentication (200)", async () => {
    successR2Response();

    const res = await GET(
      makeRequest("listings/user1/img-full.webp"),
      makeParams(["listings", "user1", "img-full.webp"]),
    );

    expect(res.status).toBe(200);
    // auth() should never be called for public prefixes
    expect(mockAuth).not.toHaveBeenCalled();
  });

  // ── Test 2: Public avatar/profile image — no auth required ───────────────
  it("serves a public profile image without authentication (200)", async () => {
    successR2Response();

    const res = await GET(
      makeRequest("profiles/user1/avatar/photo.webp"),
      makeParams(["profiles", "user1", "avatar", "photo.webp"]),
    );

    expect(res.status).toBe(200);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  // ── Test 3: Dispute image — unauthenticated returns 401 ──────────────────
  it("returns 401 for an unauthenticated request to a dispute image", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(
      makeRequest(`disputes/${ORDER_ID}/evidence.jpg`),
      makeParams(["disputes", ORDER_ID, "evidence.jpg"]),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorised");
    // R2 must NOT be hit for unauthenticated requests
    expect(mockR2Send).not.toHaveBeenCalled();
  });

  // ── Test 4: Dispute image — authenticated non-party returns 403 ──────────
  it("returns 403 when an authenticated user is not a party to the order", async () => {
    mockAuth.mockResolvedValue(sessionFor(OTHER_ID));
    mockIsUserPartyToOrder.mockResolvedValue(false);

    const res = await GET(
      makeRequest(`disputes/${ORDER_ID}/evidence.jpg`),
      makeParams(["disputes", ORDER_ID, "evidence.jpg"]),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(mockIsUserPartyToOrder).toHaveBeenCalledWith(ORDER_ID, OTHER_ID);
    expect(mockR2Send).not.toHaveBeenCalled();
  });

  // ── Test 5: Dispute image — authenticated buyer returns 200 ──────────────
  it("serves a dispute image to the order buyer (200)", async () => {
    mockAuth.mockResolvedValue(sessionFor(BUYER_ID));
    mockIsUserPartyToOrder.mockResolvedValue(true);
    successR2Response();

    const res = await GET(
      makeRequest(`disputes/${ORDER_ID}/evidence.jpg`),
      makeParams(["disputes", ORDER_ID, "evidence.jpg"]),
    );

    expect(res.status).toBe(200);
    expect(mockIsUserPartyToOrder).toHaveBeenCalledWith(ORDER_ID, BUYER_ID);
  });

  // ── Test 6: Dispute image — authenticated seller returns 200 ─────────────
  it("serves a dispute image to the order seller (200)", async () => {
    mockAuth.mockResolvedValue(sessionFor(SELLER_ID));
    mockIsUserPartyToOrder.mockResolvedValue(true);
    successR2Response();

    const res = await GET(
      makeRequest(`disputes/${ORDER_ID}/evidence.jpg`),
      makeParams(["disputes", ORDER_ID, "evidence.jpg"]),
    );

    expect(res.status).toBe(200);
    expect(mockIsUserPartyToOrder).toHaveBeenCalledWith(ORDER_ID, SELLER_ID);
  });

  // ── Test 7: Dispute image — authenticated admin bypasses party check ──────
  it("serves a dispute image to an admin without party check (200)", async () => {
    mockAuth.mockResolvedValue(sessionFor(ADMIN_ID, true));
    successR2Response();

    const res = await GET(
      makeRequest(`disputes/${ORDER_ID}/evidence.jpg`),
      makeParams(["disputes", ORDER_ID, "evidence.jpg"]),
    );

    expect(res.status).toBe(200);
    // Admin should bypass the isUserPartyToOrder query
    expect(mockIsUserPartyToOrder).not.toHaveBeenCalled();
  });

  // ── Test 8: Export file — owner returns 200 ───────────────────────────────
  it("serves an export file to the owning user (200)", async () => {
    const EXPORT_OWNER = "user-export-owner";
    mockAuth.mockResolvedValue(sessionFor(EXPORT_OWNER));
    successR2Response();

    const res = await GET(
      makeRequest(`exports/${EXPORT_OWNER}/2026-data-export.json`),
      makeParams(["exports", EXPORT_OWNER, "2026-data-export.json"]),
    );

    expect(res.status).toBe(200);
    // orderRepository must NOT be called for OWNER_ONLY prefix
    expect(mockIsUserPartyToOrder).not.toHaveBeenCalled();
  });

  // ── Test 9: Export file — different user returns 403 ─────────────────────
  it("returns 403 when a different user tries to access an export file", async () => {
    const EXPORT_OWNER = "user-export-owner";
    const OTHER_USER = "user-other";
    mockAuth.mockResolvedValue(sessionFor(OTHER_USER));

    const res = await GET(
      makeRequest(`exports/${EXPORT_OWNER}/2026-data-export.json`),
      makeParams(["exports", EXPORT_OWNER, "2026-data-export.json"]),
    );

    expect(res.status).toBe(403);
    expect(mockR2Send).not.toHaveBeenCalled();
  });

  // ── Test 10: KYC file — admin returns 200 ────────────────────────────────
  it("serves a KYC verification document to an admin (200)", async () => {
    mockAuth.mockResolvedValue(sessionFor(ADMIN_ID, true));
    successR2Response();

    const res = await GET(
      makeRequest(`verification/user1/passport.jpg`),
      makeParams(["verification", "user1", "passport.jpg"]),
    );

    expect(res.status).toBe(200);
  });

  // ── Test 11: KYC file — non-admin authenticated user returns 403 ──────────
  it("returns 403 when a non-admin tries to access a KYC document", async () => {
    mockAuth.mockResolvedValue(sessionFor("any-user", false));

    const res = await GET(
      makeRequest(`verification/user1/passport.jpg`),
      makeParams(["verification", "user1", "passport.jpg"]),
    );

    expect(res.status).toBe(403);
    expect(mockR2Send).not.toHaveBeenCalled();
  });

  // ── Test 12: Unknown prefix — returns 404 (fail closed) ──────────────────
  it("returns 404 for an unknown key prefix (fail closed)", async () => {
    const res = await GET(
      makeRequest(`secrets/something/private.dat`),
      makeParams(["secrets", "something", "private.dat"]),
    );

    expect(res.status).toBe(404);
    // Must not query auth or R2 for unknown prefixes
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockR2Send).not.toHaveBeenCalled();
  });
});
