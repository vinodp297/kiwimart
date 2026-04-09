// src/test/verification-application.test.ts
// ─── Seller Verification Application + Review ───────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock requireUser / requireAdmin ─────────────────────────────────────────
const mockRequireUser = vi.fn();
const mockRequireAdmin = vi.fn();

vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
}));
vi.mock("@/server/lib/requireAdmin", () => ({
  requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a),
}));

// ── Mock repositories ───────────────────────────────────────────────────────
const mockFindForVerificationApp = vi.fn();
const mockUpsertApplication = vi.fn();
const mockFindForReview = vi.fn();
const mockUpdateDecision = vi.fn();
const mockNotifyAdmins = vi.fn();
const mockAggregateBuyerRatings = vi.fn();
const mockUserUpdate = vi.fn();

vi.mock("@/modules/sellers/verification.repository", () => ({
  verificationRepository: {
    findForVerificationApplication: undefined, // not used directly
    upsertApplication: (...a: unknown[]) => mockUpsertApplication(...a),
    findForReview: (...a: unknown[]) => mockFindForReview(...a),
    updateDecision: (...a: unknown[]) => mockUpdateDecision(...a),
  },
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findForVerificationApplication: (...a: unknown[]) =>
      mockFindForVerificationApp(...a),
    update: (...a: unknown[]) => mockUserUpdate(...a),
    findEmailVerified: vi.fn().mockResolvedValue({ emailVerified: new Date() }),
  },
}));

vi.mock("@/modules/reviews/review.repository", () => ({
  reviewRepository: {
    aggregateBuyerRatings: (...a: unknown[]) => mockAggregateBuyerRatings(...a),
  },
}));

vi.mock("@/modules/notifications/notification.repository", () => ({
  notificationRepository: {
    notifyAdmins: (...a: unknown[]) => mockNotifyAdmins(...a),
  },
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/validators", () => ({
  reviewVerificationSchema: {
    safeParse: (raw: unknown) => {
      const data = raw as Record<string, unknown>;
      if (!data?.sellerId || !data?.decision)
        return {
          success: false,
          error: { issues: [{ message: "Invalid input" }] },
        };
      return { success: true, data };
    },
  },
}));

import {
  applyForVerification,
  reviewVerificationApplication,
} from "@/server/actions/verification.application";

// Helper to safely access .error on a failed ActionResult
function getError(result: { success: boolean; error?: string }): string {
  return (result as { error: string }).error;
}

const DEFAULT_USER = {
  id: "user-1",
  email: "seller@test.nz",
  isAdmin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue(DEFAULT_USER);
  mockNotifyAdmins.mockResolvedValue(undefined);
  mockAggregateBuyerRatings.mockResolvedValue({
    _avg: { rating: 45 },
    _count: { id: 5 },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyForVerification
// ═══════════════════════════════════════════════════════════════════════════

describe("applyForVerification", () => {
  it("succeeds when all requirements met", async () => {
    mockFindForVerificationApp.mockResolvedValue({
      isVerifiedSeller: false,
      phone: "+64211234567",
      verificationApplication: null,
      _count: { sellerOrders: 3, reviewsAbout: 5 },
    });
    mockUpsertApplication.mockResolvedValue({});

    const result = await applyForVerification();
    expect(result.success).toBe(true);
    expect(mockUpsertApplication).toHaveBeenCalledWith("user-1");
  });

  it("rejects when user not found", async () => {
    mockFindForVerificationApp.mockResolvedValue(null);
    const result = await applyForVerification();
    expect(result.success).toBe(false);
    expect(getError(result)).toContain("not found");
  });

  it("rejects when already a verified seller", async () => {
    mockFindForVerificationApp.mockResolvedValue({
      isVerifiedSeller: true,
      phone: "+64211234567",
      verificationApplication: null,
      _count: { sellerOrders: 5, reviewsAbout: 3 },
    });

    const result = await applyForVerification();
    expect(result.success).toBe(false);
    expect(getError(result)).toContain("already a verified");
  });

  it("rejects when application is already pending", async () => {
    mockFindForVerificationApp.mockResolvedValue({
      isVerifiedSeller: false,
      phone: "+64211234567",
      verificationApplication: { status: "PENDING" },
      _count: { sellerOrders: 5, reviewsAbout: 3 },
    });

    const result = await applyForVerification();
    expect(result.success).toBe(false);
    expect(getError(result)).toContain("already under review");
  });

  it("rejects when no completed sales", async () => {
    mockFindForVerificationApp.mockResolvedValue({
      isVerifiedSeller: false,
      phone: "+64211234567",
      verificationApplication: null,
      _count: { sellerOrders: 0, reviewsAbout: 0 },
    });

    const result = await applyForVerification();
    expect(result.success).toBe(false);
    expect(getError(result)).toContain("1 completed sale");
  });

  it("rejects when rating is below 4.0", async () => {
    mockFindForVerificationApp.mockResolvedValue({
      isVerifiedSeller: false,
      phone: "+64211234567",
      verificationApplication: null,
      _count: { sellerOrders: 5, reviewsAbout: 3 },
    });
    mockAggregateBuyerRatings.mockResolvedValue({
      _avg: { rating: 30 }, // 3.0 / 5.0
      _count: { id: 3 },
    });

    const result = await applyForVerification();
    expect(result.success).toBe(false);
    expect(getError(result)).toContain("4.0 or above");
  });

  it("rejects when no phone number on account", async () => {
    mockFindForVerificationApp.mockResolvedValue({
      isVerifiedSeller: false,
      phone: null,
      verificationApplication: null,
      _count: { sellerOrders: 5, reviewsAbout: 3 },
    });

    const result = await applyForVerification();
    expect(result.success).toBe(false);
    expect(getError(result)).toContain("phone number");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// reviewVerificationApplication (admin)
// ═══════════════════════════════════════════════════════════════════════════

describe("reviewVerificationApplication", () => {
  beforeEach(() => {
    mockRequireAdmin.mockResolvedValue({ userId: "admin-1" });
  });

  it("approves application and marks user as verified seller", async () => {
    mockFindForReview.mockResolvedValue({ status: "PENDING" });
    mockUpdateDecision.mockResolvedValue({});
    mockUserUpdate.mockResolvedValue({});

    const result = await reviewVerificationApplication({
      sellerId: "seller-1",
      decision: "APPROVED",
      notes: "Looks good",
    });

    expect(result.success).toBe(true);
    expect(mockUpdateDecision).toHaveBeenCalledWith(
      "seller-1",
      expect.objectContaining({ status: "APPROVED" }),
    );
    expect(mockUserUpdate).toHaveBeenCalledWith(
      "seller-1",
      expect.objectContaining({ isVerifiedSeller: true }),
    );
  });

  it("rejects application without marking user as verified", async () => {
    mockFindForReview.mockResolvedValue({ status: "PENDING" });
    mockUpdateDecision.mockResolvedValue({});

    const result = await reviewVerificationApplication({
      sellerId: "seller-1",
      decision: "REJECTED",
      notes: "Needs more sales",
    });

    expect(result.success).toBe(true);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("fails when application not found", async () => {
    mockFindForReview.mockResolvedValue(null);

    const result = await reviewVerificationApplication({
      sellerId: "seller-1",
      decision: "APPROVED",
    });

    expect(result.success).toBe(false);
    expect(getError(result)).toContain("not found");
  });

  it("fails when application already reviewed", async () => {
    mockFindForReview.mockResolvedValue({ status: "APPROVED" });

    const result = await reviewVerificationApplication({
      sellerId: "seller-1",
      decision: "REJECTED",
    });

    expect(result.success).toBe(false);
    expect(getError(result)).toContain("already reviewed");
  });

  it("fails with invalid input schema", async () => {
    const result = await reviewVerificationApplication({ bad: "data" });
    expect(result.success).toBe(false);
  });

  it("returns error when requireAdmin fails", async () => {
    mockRequireAdmin.mockResolvedValue({ error: "Not an admin" });

    const result = await reviewVerificationApplication({
      sellerId: "seller-1",
      decision: "APPROVED",
    });

    expect(result.success).toBe(false);
    expect(getError(result)).toBe("Not an admin");
  });
});
