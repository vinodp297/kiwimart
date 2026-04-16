// src/test/business.actions.test.ts
// ─── Tests: Business Details Server Action ──────────────────────────────────
// Covers updateBusinessDetails:
//   auth, seller gate, rate limit, validation, NZBN uniqueness, clear branch

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

const mockExistsByNzbn = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    existsByNzbn: (...args: unknown[]) => mockExistsByNzbn(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

const { updateBusinessDetails } = await import("@/server/actions/business");
const { rateLimit } = await import("@/server/lib/rateLimit");
const { audit } = await import("@/server/lib/audit");

const TEST_SELLER = {
  id: "user_seller_biz",
  email: "s@test.com",
  isAdmin: false,
  isSellerEnabled: true,
};

const TEST_NON_SELLER = {
  id: "user_buyer_biz",
  email: "b@test.com",
  isAdmin: false,
  isSellerEnabled: false,
};

const validBusinessInput = {
  isBusinessSeller: true,
  nzbn: "9429000000001",
  isGstRegistered: true,
  gstNumber: "12-345-678",
};

describe("updateBusinessDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_SELLER);
    mockExistsByNzbn.mockResolvedValue(false);
    mockUpdate.mockResolvedValue(undefined);
  });

  it("unauthenticated → returns safe error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await updateBusinessDetails(validBusinessInput);

    expect(result.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("seller access not enabled → rejects", async () => {
    mockRequireUser.mockResolvedValueOnce(TEST_NON_SELLER);

    const result = await updateBusinessDetails(validBusinessInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/seller access is not enabled/i);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rate limit exceeded → returns wait message", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await updateBusinessDetails(validBusinessInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many requests/i);
    }
  });

  it("invalid input (schema fail) → returns validation error", async () => {
    const result = await updateBusinessDetails({
      isBusinessSeller: "yes", // wrong type
    });

    expect(result.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("business seller without NZBN → rejects", async () => {
    const result = await updateBusinessDetails({
      isBusinessSeller: true,
      isGstRegistered: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("NZBN already taken by another user → rejects", async () => {
    mockExistsByNzbn.mockResolvedValueOnce(true);

    const result = await updateBusinessDetails(validBusinessInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already registered/i);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("happy path (business + GST) → persists NZBN, GST, gstNumber", async () => {
    const result = await updateBusinessDetails(validBusinessInput);

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      TEST_SELLER.id,
      expect.objectContaining({
        nzbn: "9429000000001",
        isGstRegistered: true,
        gstNumber: "12-345-678",
      }),
    );
  });

  it("happy path (business without GST) → persists NZBN, nulls gstNumber", async () => {
    const result = await updateBusinessDetails({
      isBusinessSeller: true,
      nzbn: "9429000000002",
      isGstRegistered: false,
    });

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      TEST_SELLER.id,
      expect.objectContaining({
        nzbn: "9429000000002",
        isGstRegistered: false,
        gstNumber: null,
      }),
    );
  });

  it("non-business seller → clears NZBN, GST, gstNumber to null/false", async () => {
    const result = await updateBusinessDetails({
      isBusinessSeller: false,
      isGstRegistered: false,
    });

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(TEST_SELLER.id, {
      nzbn: null,
      isGstRegistered: false,
      gstNumber: null,
    });
  });

  it("happy path → writes audit log with metadata", async () => {
    await updateBusinessDetails(validBusinessInput);

    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_SELLER.id,
        action: "BUSINESS_DETAILS_UPDATED",
        entityType: "User",
        entityId: TEST_SELLER.id,
        metadata: expect.objectContaining({
          isBusinessSeller: true,
          nzbn: "9429000000001",
          isGstRegistered: true,
        }),
      }),
    );
  });

  it("repository throws on update → returns safe fallback", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("Prisma P2002"));

    const result = await updateBusinessDetails(validBusinessInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});
