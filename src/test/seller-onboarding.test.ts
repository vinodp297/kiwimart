// src/test/seller-onboarding.test.ts
// ─── Tests for Seller Onboarding & Verification Actions ─────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock requireUser ─────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: mockRequireUser,
}));

// ── Mock requireAdmin ────────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock("@/server/lib/requireAdmin", () => ({
  requireAdmin: mockRequireAdmin,
}));

// ── Mock notification service ────────────────────────────────────────────────
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
import { createNotification } from "@/modules/notifications/notification.service";

// ── Mock email client ────────────────────────────────────────────────────────
const mockEmailSend = vi.fn().mockResolvedValue(undefined);
vi.mock("@/infrastructure/email/client", () => ({
  getEmailClient: vi.fn().mockReturnValue({
    emails: {
      send: mockEmailSend,
    },
  }),
  EMAIL_FROM: "noreply@test.com",
}));

// ── Mock user repository with additional methods ─────────────────────────────
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
    findForIdApproval: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "seller@test.com",
      idVerified: false,
      idSubmittedAt: new Date(),
    }),
    findOnboardingStatus: vi.fn().mockResolvedValue({
      isOnboardingCompleted: false,
      onboardingIntent: null,
      region: null,
      bio: null,
      displayName: "Test User",
      emailVerified: new Date(),
      isStripeOnboarded: false,
    }),
    findAdmins: vi.fn().mockResolvedValue([]),
  },
}));
import { userRepository } from "@/modules/users/user.repository";

// ── Mock dynamic-lists ───────────────────────────────────────────────────────
vi.mock("@/lib/dynamic-lists", () => ({
  getListValues: vi
    .fn()
    .mockResolvedValue(["AUCKLAND", "WELLINGTON", "CANTERBURY"]),
}));

// ── Mock requirePermission (used by requireAdmin) ────────────────────────────
vi.mock("@/shared/auth/requirePermission", () => ({
  requireAnyAdmin: vi
    .fn()
    .mockResolvedValue({ id: "admin-1", role: "SUPER_ADMIN" }),
}));

// ── Mock validators — override approveIdSchema to accept plain strings ──────
vi.mock("@/server/validators", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/validators")>();
  const { z } = await import("zod");
  return {
    ...actual,
    // Override CUID check so test IDs like "user-1" pass validation
    approveIdSchema: z.object({ userId: z.string().min(1) }),
  };
});

// ── Lazy imports AFTER mocks ─────────────────────────────────────────────────
const {
  acceptSellerTerms,
  submitIdVerification,
  approveIdVerification,
  rejectIdVerification,
} = await import("@/server/actions/seller");
// enqueueEmail is mocked globally by setup.ts; import for assertion
const { enqueueEmail } = await import("@/lib/email-queue");

const { completeOnboarding, getOnboardingStatus } =
  await import("@/server/actions/onboarding");

// ── Mock authenticated user ──────────────────────────────────────────────────

const mockSellerUser = {
  id: "user-1",
  email: "seller@test.com",
  isAdmin: false,
  isSellerEnabled: true,
  isStripeOnboarded: false,
};

const mockNonSellerUser = {
  id: "user-2",
  email: "buyer@test.com",
  isAdmin: false,
  isSellerEnabled: false,
  isStripeOnboarded: false,
};

describe("Seller Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(mockSellerUser);
    mockRequireAdmin.mockResolvedValue({ userId: "admin-1" });
    // Reset email mock to resolve
    mockEmailSend.mockResolvedValue(undefined);
  });

  // ── acceptSellerTerms ──────────────────────────────────────────────────

  describe("acceptSellerTerms", () => {
    it("user accepts seller terms successfully", async () => {
      const result = await acceptSellerTerms();

      expect(result.success).toBe(true);
      expect(userRepository.update).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          sellerTermsAcceptedAt: expect.any(Date),
        }),
      );
    });

    it("fails if seller access not enabled", async () => {
      mockRequireUser.mockResolvedValue(mockNonSellerUser);

      const result = await acceptSellerTerms();

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "not enabled",
      );
    });

    it("returns error when not authenticated", async () => {
      mockRequireUser.mockRejectedValue(new Error("Unauthorised"));

      const result = await acceptSellerTerms();

      expect(result.success).toBe(false);
    });
  });

  // ── submitIdVerification ───────────────────────────────────────────────

  describe("submitIdVerification", () => {
    it("submits ID verification successfully", async () => {
      vi.mocked(userRepository.findIdVerificationStatus).mockResolvedValue({
        idVerified: false,
        idSubmittedAt: null,
      } as never);

      const result = await submitIdVerification();

      expect(result.success).toBe(true);
      expect(userRepository.update).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          idSubmittedAt: expect.any(Date),
        }),
      );
    });

    it("fails if already verified", async () => {
      vi.mocked(userRepository.findIdVerificationStatus).mockResolvedValue({
        idVerified: true,
        idSubmittedAt: new Date(),
      } as never);

      const result = await submitIdVerification();

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "already verified",
      );
    });

    it("fails if already submitted and pending", async () => {
      vi.mocked(userRepository.findIdVerificationStatus).mockResolvedValue({
        idVerified: false,
        idSubmittedAt: new Date(),
      } as never);

      const result = await submitIdVerification();

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "already pending",
      );
    });

    it("fails if seller access not enabled", async () => {
      mockRequireUser.mockResolvedValue(mockNonSellerUser);

      const result = await submitIdVerification();

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "not enabled",
      );
    });

    it("sends admin notification email on submission", async () => {
      vi.mocked(userRepository.findIdVerificationStatus).mockResolvedValue({
        idVerified: false,
        idSubmittedAt: null,
      } as never);
      process.env.ADMIN_EMAIL = "admin@test.com";

      await submitIdVerification();

      // seller.ts now queues via enqueueEmail — assert on the queue job payload
      expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
        expect.objectContaining({
          template: "adminIdVerification",
          to: "admin@test.com",
        }),
      );

      delete process.env.ADMIN_EMAIL;
    });
  });

  // ── approveIdVerification ──────────────────────────────────────────────

  describe("approveIdVerification", () => {
    it("admin approves verification successfully", async () => {
      vi.mocked(userRepository.findForIdApproval).mockResolvedValue({
        id: "user-1",
        email: "seller@test.com",
        idVerified: false,
        idSubmittedAt: new Date(),
      } as never);

      const result = await approveIdVerification("user-1");

      expect(result.success).toBe(true);
      expect(userRepository.update).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          idVerified: true,
          idVerifiedAt: expect.any(Date),
        }),
      );
    });

    it("sends email to seller on approval", async () => {
      vi.mocked(userRepository.findForIdApproval).mockResolvedValue({
        id: "user-1",
        email: "seller@test.com",
        idVerified: false,
        idSubmittedAt: new Date(),
      } as never);

      await approveIdVerification("user-1");

      // seller.ts now queues via enqueueEmail — assert on the queue job payload
      expect(vi.mocked(enqueueEmail)).toHaveBeenCalledWith(
        expect.objectContaining({
          template: "adminIdVerification",
          to: "seller@test.com",
        }),
      );
    });

    it("creates notification on approval", async () => {
      vi.mocked(userRepository.findForIdApproval).mockResolvedValue({
        id: "user-1",
        email: "seller@test.com",
        idVerified: false,
        idSubmittedAt: new Date(),
      } as never);

      await approveIdVerification("user-1");

      // Wait for fire-and-forget
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          type: "ID_VERIFIED",
        }),
      );
    });

    it("rejects if user already verified", async () => {
      vi.mocked(userRepository.findForIdApproval).mockResolvedValue({
        id: "user-1",
        email: "seller@test.com",
        idVerified: true,
        idSubmittedAt: new Date(),
      } as never);

      const result = await approveIdVerification("user-1");

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "already ID-verified",
      );
    });

    it("rejects if no submission pending", async () => {
      vi.mocked(userRepository.findForIdApproval).mockResolvedValue({
        id: "user-1",
        email: "seller@test.com",
        idVerified: false,
        idSubmittedAt: null,
      } as never);

      const result = await approveIdVerification("user-1");

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "not submitted",
      );
    });

    it("rejects if user not found", async () => {
      vi.mocked(userRepository.findForIdApproval).mockResolvedValue(null);

      const result = await approveIdVerification("nonexistent");

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "not found",
      );
    });

    it("fails if admin check fails", async () => {
      mockRequireAdmin.mockResolvedValue({ error: "Not an admin" });

      const result = await approveIdVerification("user-1");

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "Not an admin",
      );
    });
  });

  // ── rejectIdVerification ───────────────────────────────────────────────

  describe("rejectIdVerification", () => {
    it("admin rejects verification with reason", async () => {
      vi.mocked(userRepository.findForIdApproval).mockResolvedValue({
        id: "user-1",
        email: "seller@test.com",
        idVerified: false,
        idSubmittedAt: new Date(),
      } as never);

      const result = await rejectIdVerification({
        userId: "user-1",
        reason: "DOCUMENT_EXPIRED",
        notes: "",
      });

      expect(result.success).toBe(true);
      // Clears idSubmittedAt so user can resubmit
      expect(userRepository.update).toHaveBeenCalledWith("user-1", {
        idSubmittedAt: null,
      });
    });

    it("creates notification on rejection", async () => {
      vi.mocked(userRepository.findForIdApproval).mockResolvedValue({
        id: "user-1",
        email: "seller@test.com",
        idVerified: false,
        idSubmittedAt: new Date(),
      } as never);

      await rejectIdVerification({
        userId: "user-1",
        reason: "NAME_MISMATCH",
        notes: "",
      });

      // Wait for fire-and-forget
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          type: "SYSTEM",
          title: "ID verification not approved",
        }),
      );
    });

    it("rejects if user already verified", async () => {
      vi.mocked(userRepository.findForIdApproval).mockResolvedValue({
        id: "user-1",
        email: "seller@test.com",
        idVerified: true,
        idSubmittedAt: new Date(),
      } as never);

      const result = await rejectIdVerification({
        userId: "user-1",
        reason: "DOCUMENT_EXPIRED",
        notes: "",
      });

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "already ID verified",
      );
    });

    it("rejects if user not found", async () => {
      vi.mocked(userRepository.findForIdApproval).mockResolvedValue(null);

      const result = await rejectIdVerification({
        userId: "nonexistent",
        reason: "OTHER",
        notes: "Test reason",
      });

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "not found",
      );
    });
  });

  // ── completeOnboarding ─────────────────────────────────────────────────

  describe("completeOnboarding", () => {
    it("completes onboarding with valid input", async () => {
      const result = await completeOnboarding({
        intent: "BOTH",
        region: "AUCKLAND",
      });

      expect(result.success).toBe(true);
      expect(userRepository.update).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          isOnboardingCompleted: true,
          onboardingIntent: "BOTH",
          region: "AUCKLAND",
        }),
      );
    });

    it("ignores invalid region", async () => {
      const result = await completeOnboarding({
        intent: "BUY",
        region: "INVALID_REGION",
      });

      expect(result.success).toBe(true);
      // region should NOT be in the update when invalid
      expect(userRepository.update).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          isOnboardingCompleted: true,
          onboardingIntent: "BUY",
        }),
      );
    });

    it("returns error when not authenticated", async () => {
      mockRequireUser.mockRejectedValue(new Error("Unauthorised"));

      const result = await completeOnboarding({
        intent: "BOTH",
        region: "AUCKLAND",
      });

      expect(result.success).toBe(false);
    });
  });

  // ── getOnboardingStatus ────────────────────────────────────────────────

  describe("getOnboardingStatus", () => {
    it("returns onboarding status for current user", async () => {
      const result = await getOnboardingStatus();

      expect(result.success).toBe(true);
      expect((result as { success: true; data: unknown }).data).toEqual(
        expect.objectContaining({
          isOnboardingCompleted: false,
          displayName: "Test User",
        }),
      );
    });

    it("returns error if user not found in repository", async () => {
      vi.mocked(userRepository.findOnboardingStatus).mockResolvedValue(
        null as never,
      );

      const result = await getOnboardingStatus();

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        "not found",
      );
    });

    it("returns error when not authenticated", async () => {
      mockRequireUser.mockRejectedValue(new Error("Unauthorised"));

      const result = await getOnboardingStatus();

      expect(result.success).toBe(false);
    });
  });
});
