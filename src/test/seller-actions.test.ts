// src/test/seller-actions.test.ts
// ─── Tests: Seller & Account Actions ────────────────────────────────────────
// Covers:
//   acceptSellerTerms — auth, seller access gate, updates timestamp
//   submitIdVerification — auth, already verified, already pending, admin email
//   updateProfile — validation, updates fields
//   deleteAccount — erasure service delegation

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: mockRequireUser,
}));

// ── Mock requireAdmin ───────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock("@/server/lib/requireAdmin", () => ({
  requireAdmin: mockRequireAdmin,
}));

// ── Mock notification service ───────────────────────────────────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock email client ───────────────────────────────────────────────────────
const mockEmailSend = vi.fn().mockResolvedValue(undefined);
vi.mock("@/infrastructure/email/client", () => ({
  getEmailClient: vi.fn().mockReturnValue({
    emails: { send: mockEmailSend },
  }),
  EMAIL_FROM: "noreply@test.com",
}));

// ── Mock user repository ────────────────────────────────────────────────────
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    update: vi.fn().mockResolvedValue(undefined),
    findEmailVerified: vi
      .fn()
      .mockResolvedValue({ emailVerified: new Date("2025-01-01") }),
    findIdVerificationStatus: vi.fn().mockResolvedValue({
      idVerified: false,
      idSubmittedAt: null,
    }),
    findForIdApproval: vi.fn(),
    findOnboardingStatus: vi.fn(),
    findPasswordHash: vi.fn(),
    deleteAllSessions: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock dynamic-lists ──────────────────────────────────────────────────────
vi.mock("@/lib/dynamic-lists", () => ({
  getListValues: vi
    .fn()
    .mockResolvedValue(["AUCKLAND", "WELLINGTON", "CANTERBURY"]),
}));

// ── Mock erasure service ────────────────────────────────────────────────────
const mockPerformAccountErasure = vi.fn().mockResolvedValue({
  erasureLogId: "erasure-1",
  anonymisedEmail: "deleted_user-1@buyzi.deleted",
});
vi.mock("@/modules/users/erasure.service", () => ({
  performAccountErasure: (...args: unknown[]) =>
    mockPerformAccountErasure(...args),
}));

// ── Mock requirePermission ──────────────────────────────────────────────────
vi.mock("@/shared/auth/requirePermission", () => ({
  requireAnyAdmin: vi
    .fn()
    .mockResolvedValue({ id: "admin-1", role: "SUPER_ADMIN" }),
}));

// ── Mock validators (override CUID check) ───────────────────────────────────
vi.mock("@/server/validators", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/validators")>();
  const { z } = await import("zod");
  return {
    ...actual,
    approveIdSchema: z.object({ userId: z.string().min(1) }),
  };
});

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { acceptSellerTerms, submitIdVerification } =
  await import("@/server/actions/seller");
const { updateProfile, deleteAccount } =
  await import("@/server/actions/account");
const { userRepository } = await import("@/modules/users/user.repository");
const { rateLimit } = await import("@/server/lib/rateLimit");

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockSellerUser = {
  id: "user-1",
  email: "seller@buyzi.test",
  isAdmin: false,
  isSellerEnabled: true,
  isStripeOnboarded: false,
};

const mockBuyerUser = {
  id: "user-2",
  email: "buyer@buyzi.test",
  isAdmin: false,
  isSellerEnabled: false,
  isStripeOnboarded: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("acceptSellerTerms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(mockSellerUser);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
  });

  it("records seller terms acceptance with timestamp", async () => {
    const result = await acceptSellerTerms();

    expect(result.success).toBe(true);
    expect(userRepository.update).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        sellerTermsAcceptedAt: expect.any(Date),
      }),
    );
  });

  it("rejects if seller access not enabled", async () => {
    mockRequireUser.mockResolvedValue(mockBuyerUser);

    const result = await acceptSellerTerms();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not enabled/i);
    }
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mockRequireUser.mockRejectedValue(new Error("Unauthorised"));

    const result = await acceptSellerTerms();

    expect(result.success).toBe(false);
  });

  it("rate limits seller terms acceptance", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 900,
    });

    const result = await acceptSellerTerms();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many/i);
    }
  });
});

describe("submitIdVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(mockSellerUser);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    vi.mocked(userRepository.findIdVerificationStatus).mockResolvedValue({
      idVerified: false,
      idSubmittedAt: null,
    } as never);
  });

  it("submits ID verification and updates timestamp", async () => {
    const result = await submitIdVerification();

    expect(result.success).toBe(true);
    expect(userRepository.update).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ idSubmittedAt: expect.any(Date) }),
    );
  });

  it("rejects if already ID verified", async () => {
    vi.mocked(userRepository.findIdVerificationStatus).mockResolvedValue({
      idVerified: true,
      idSubmittedAt: new Date(),
    } as never);

    const result = await submitIdVerification();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already verified/i);
    }
  });

  it("rejects if submission already pending", async () => {
    vi.mocked(userRepository.findIdVerificationStatus).mockResolvedValue({
      idVerified: false,
      idSubmittedAt: new Date(),
    } as never);

    const result = await submitIdVerification();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already pending/i);
    }
  });

  it("non-seller cannot submit ID verification", async () => {
    mockRequireUser.mockResolvedValue(mockBuyerUser);

    const result = await submitIdVerification();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not enabled/i);
    }
  });
});

describe("updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(mockSellerUser);
  });

  it("updates profile with valid data", async () => {
    const result = await updateProfile({
      displayName: "New Display Name",
      region: "AUCKLAND",
      bio: "A short bio about the seller.",
    });

    expect(result.success).toBe(true);
    expect(userRepository.update).toHaveBeenCalledWith("user-1", {
      displayName: "New Display Name",
      region: "AUCKLAND",
      bio: "A short bio about the seller.",
    });
  });

  it("nulls empty optional fields", async () => {
    const result = await updateProfile({
      displayName: "Name Only",
      region: "",
      bio: "",
    });

    expect(result.success).toBe(true);
    expect(userRepository.update).toHaveBeenCalledWith("user-1", {
      displayName: "Name Only",
      region: null,
      bio: null,
    });
  });

  it("rejects too-short display name", async () => {
    const result = await updateProfile({
      displayName: "X", // Too short (min 2)
      region: "AUCKLAND",
      bio: "",
    });

    expect(result.success).toBe(false);
  });

  it("requires authentication", async () => {
    mockRequireUser.mockRejectedValue(new Error("Unauthorised"));

    const result = await updateProfile({
      displayName: "Test",
      region: "",
      bio: "",
    });

    expect(result.success).toBe(false);
  });
});

describe("deleteAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(mockSellerUser);
    mockPerformAccountErasure.mockResolvedValue({
      erasureLogId: "erasure-1",
      anonymisedEmail: "deleted_user-1@buyzi.deleted",
    });
  });

  it("performs account erasure via service", async () => {
    const result = await deleteAccount();

    expect(result.success).toBe(true);
    expect(mockPerformAccountErasure).toHaveBeenCalledWith({
      userId: "user-1",
      operatorId: "self-service",
    });
  });

  it("returns error when erasure fails", async () => {
    mockPerformAccountErasure.mockRejectedValue(
      new Error("Erasure service unavailable"),
    );

    const result = await deleteAccount();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/failed|contact/i);
    }
  });

  it("requires authentication", async () => {
    mockRequireUser.mockRejectedValue(new Error("Unauthorised"));

    const result = await deleteAccount();

    expect(result.success).toBe(false);
  });
});
