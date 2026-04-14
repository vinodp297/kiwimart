// src/test/admin-rate-limit.test.ts
// ─── Tests: Rate limiting on sensitive admin actions ─────────────────────────
// Covers:
//   approveIdVerification:
//     1. Succeeds when within rate limit
//     2. Returns RATE_LIMITED error when limit exceeded
//     3. Rate limit key is admin-ID-based, not IP-based
//     4. Fails open (allows action) when rate limiter throws
//   rejectIdVerification:
//     5. Returns RATE_LIMITED error when limit exceeded
//   banUser:
//     6. Returns RATE_LIMITED error when limit exceeded
//     7. Uses adminBan key type
//   unbanUser:
//     8. Returns RATE_LIMITED error when limit exceeded
//   approveListing:
//     9. Returns RATE_LIMITED error when limit exceeded
//   requestListingChanges:
//     10. Returns RATE_LIMITED error when limit exceeded
//   rejectListing:
//     11. Returns RATE_LIMITED error when limit exceeded
//   Rate limit isolation:
//     12. Different admin users have independent rate limit counters
//     13. Rate limit allows action after window resets (mock behaviour)

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Must be mocked before importing the modules under test ────────────────────

vi.mock("server-only", () => ({}));

// Override approveIdSchema so test IDs like "user-1" (non-CUID) pass validation.
// The production schema uses .cuid() which correctly rejects non-CUID strings,
// but we only want to test rate-limiting behaviour here, not input validation.
vi.mock("@/server/validators", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/validators")>();
  return {
    ...actual,
    approveIdSchema: {
      safeParse: (data: { userId: string }) => ({
        success: true,
        data: { userId: data.userId },
      }),
    },
  };
});

vi.mock("@/server/lib/requireAdmin", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/shared/auth/requirePermission", () => ({
  requirePermission: vi.fn(),
  requireSuperAdmin: vi.fn(),
  requireAnyAdmin: vi.fn(),
}));

vi.mock("@/modules/admin/admin.service", () => ({
  adminService: {
    banUser: vi.fn().mockResolvedValue(undefined),
    unbanUser: vi.fn().mockResolvedValue(undefined),
    toggleSellerEnabled: vi.fn().mockResolvedValue(undefined),
    resolveReport: vi.fn().mockResolvedValue(undefined),
    resolveDispute: vi.fn().mockResolvedValue(undefined),
    resolveDisputePartialRefund: vi.fn().mockResolvedValue(undefined),
    overrideAutoResolution: vi.fn().mockResolvedValue(undefined),
    requestMoreInfo: vi.fn().mockResolvedValue(undefined),
    flagUserForFraud: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findForIdApproval: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    findForListingAuth: vi.fn().mockResolvedValue({
      emailVerified: new Date(),
      sellerTermsAcceptedAt: new Date(),
      isSellerEnabled: true,
    }),
    findForTierOverride: vi.fn().mockResolvedValue(null),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  approveIdVerification,
  rejectIdVerification,
} from "@/server/actions/seller";
import { banUser, unbanUser } from "@/server/actions/admin";
import {
  approveListing,
  requestListingChanges,
  rejectListing,
} from "@/server/actions/admin-listing-moderation";
import { rateLimit } from "@/server/lib/rateLimit";
import { logger } from "@/shared/logger";
import { requireAdmin } from "@/server/lib/requireAdmin";
import { requirePermission } from "@/shared/auth/requirePermission";
import { userRepository } from "@/modules/users/user.repository";
import { adminService } from "@/modules/admin/admin.service";
import db from "@/lib/db";
import type { AdminUser } from "@/shared/auth/requirePermission";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ADMIN_1: AdminUser = {
  id: "admin-1",
  email: "admin1@test.com",
  displayName: "Admin One",
  isAdmin: true,
  adminRole: "SUPER_ADMIN",
};

const ADMIN_2: AdminUser = {
  id: "admin-2",
  email: "admin2@test.com",
  displayName: "Admin Two",
  isAdmin: true,
  adminRole: "TRUST_SAFETY_ADMIN",
};

const mockTargetUser = {
  id: "user-1",
  email: "seller@test.com",
  displayName: "Test Seller",
  idVerified: false,
  idSubmittedAt: new Date("2025-06-01T10:00:00.000Z"),
};

const RATE_LIMITED_RESULT = {
  success: false,
  remaining: 0,
  reset: Date.now() + 3_600_000,
  retryAfter: 3600,
};

const RATE_ALLOWED_RESULT = {
  success: true,
  remaining: 19,
  reset: Date.now() + 3_600_000,
  retryAfter: 0,
};

// ── approveIdVerification ─────────────────────────────────────────────────────

describe("approveIdVerification — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: rate limit allows
    vi.mocked(rateLimit).mockResolvedValue(RATE_ALLOWED_RESULT);
    vi.mocked(requireAdmin).mockResolvedValue({ userId: ADMIN_1.id });
    vi.mocked(userRepository.findForIdApproval).mockResolvedValue(
      mockTargetUser as never,
    );
    vi.mocked(userRepository.update).mockResolvedValue({} as never);
  });

  // Test 1
  it("succeeds when within rate limit", async () => {
    const result = await approveIdVerification("user-1");

    expect(result.success).toBe(true);
    expect(rateLimit).toHaveBeenCalledWith(
      "adminIdVerify",
      expect.stringContaining("admin-1"),
    );
  });

  // Test 2
  it("returns RATE_LIMITED error when limit is exceeded", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce(RATE_LIMITED_RESULT);

    const result = await approveIdVerification("user-1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many requests/i);
      expect(result.error).toMatch(/slow down/i);
    }
    // Business logic must NOT have run
    expect(userRepository.findForIdApproval).not.toHaveBeenCalled();
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  // Test 3
  it("keys rate limit by admin user ID — not by IP address", async () => {
    await approveIdVerification("user-1");

    const [type, key] = vi.mocked(rateLimit).mock.calls[0]!;
    expect(type).toBe("adminIdVerify");
    expect(key).toContain("admin-1");
    // Must NOT be IP-based
    expect(key).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    expect(key).not.toContain("127.0.0.1");
    expect(key).not.toContain("unknown");
  });

  // Test 4
  it("fails open — allows the action when rate limiter throws (Redis unavailable)", async () => {
    vi.mocked(rateLimit).mockRejectedValueOnce(
      new Error("Redis connection temporarily unavailable"),
    );

    const result = await approveIdVerification("user-1");

    // Action must proceed despite rate limiter failure
    expect(result.success).toBe(true);
    // Warning must be logged
    expect(logger.warn).toHaveBeenCalledWith(
      "admin:rate-limit-unavailable",
      expect.objectContaining({
        action: "approveIdVerification",
        adminId: "admin-1",
      }),
    );
    // Business logic still ran
    expect(userRepository.findForIdApproval).toHaveBeenCalled();
  });
});

// ── rejectIdVerification ──────────────────────────────────────────────────────

describe("rejectIdVerification — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue(RATE_ALLOWED_RESULT);
    vi.mocked(requireAdmin).mockResolvedValue({ userId: ADMIN_1.id });
    vi.mocked(userRepository.findForIdApproval).mockResolvedValue({
      ...mockTargetUser,
      idVerified: false,
    } as never);
  });

  // Test 5
  it("returns RATE_LIMITED error when limit is exceeded", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce(RATE_LIMITED_RESULT);

    const result = await rejectIdVerification({
      userId: "user-1",
      reason: "DOCUMENT_UNREADABLE",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many requests/i);
    }
    // No DB calls should have been made
    expect(userRepository.findForIdApproval).not.toHaveBeenCalled();
  });

  it("uses adminIdVerify key type for reject action", async () => {
    vi.mocked(db.verificationApplication.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    await rejectIdVerification({
      userId: "user-1",
      reason: "DOCUMENT_UNREADABLE",
    });

    expect(rateLimit).toHaveBeenCalledWith(
      "adminIdVerify",
      expect.stringContaining("admin-1"),
    );
  });
});

// ── banUser ───────────────────────────────────────────────────────────────────

describe("banUser — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue(RATE_ALLOWED_RESULT);
    vi.mocked(requirePermission).mockResolvedValue(ADMIN_1);
    // Explicitly re-apply service mock implementation after clearAllMocks
    vi.mocked(adminService.banUser).mockResolvedValue(undefined);
    vi.mocked(adminService.unbanUser).mockResolvedValue(undefined);
  });

  // Test 6
  it("returns RATE_LIMITED error when limit is exceeded", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce(RATE_LIMITED_RESULT);

    const result = await banUser("user-target", "Violation of terms");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many requests/i);
    }
  });

  // Test 7
  it("uses adminBan key type and includes admin ID in the key", async () => {
    await banUser("user-target", "Violation of terms");

    expect(rateLimit).toHaveBeenCalledWith(
      "adminBan",
      expect.stringContaining("admin-1"),
    );
    expect(adminService.banUser).toHaveBeenCalled();
  });

  it("fails closed when rate limiter throws — ban is blocked, not allowed", async () => {
    vi.mocked(rateLimit).mockRejectedValueOnce(
      new Error("Redis temporarily unavailable"),
    );

    const result = await banUser("user-target", "Violation of terms");

    // Fail-closed: banUser must NOT proceed when rate limiter is unavailable
    expect(result.success).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      "admin.rateLimit.failure",
      expect.objectContaining({ action: "banUser", adminId: "admin-1" }),
    );
    // Ban must not have executed
    expect(adminService.banUser).not.toHaveBeenCalled();
  });
});

// ── unbanUser ─────────────────────────────────────────────────────────────────

describe("unbanUser — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue(RATE_ALLOWED_RESULT);
    vi.mocked(requirePermission).mockResolvedValue(ADMIN_1);
    vi.mocked(adminService.unbanUser).mockResolvedValue(undefined);
  });

  // Test 8
  it("returns RATE_LIMITED error when limit is exceeded", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce(RATE_LIMITED_RESULT);

    const result = await unbanUser("user-target");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many requests/i);
    }
  });

  it("uses adminBan key type for unban action", async () => {
    await unbanUser("user-target");

    expect(rateLimit).toHaveBeenCalledWith(
      "adminBan",
      expect.stringContaining("admin-1"),
    );
    expect(adminService.unbanUser).toHaveBeenCalled();
  });
});

// ── approveListing ────────────────────────────────────────────────────────────

describe("approveListing — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue(RATE_ALLOWED_RESULT);
    vi.mocked(requirePermission).mockResolvedValue(ADMIN_1);
  });

  // Test 9
  it("returns RATE_LIMITED error when limit is exceeded", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce(RATE_LIMITED_RESULT);

    const result = await approveListing("listing-1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many requests/i);
    }
    // DB listing lookup must NOT have run
    expect(db.listing.findUnique).not.toHaveBeenCalled();
  });

  it("uses adminListingMod key type", async () => {
    // Make the action fail gracefully at listing lookup (not rate limit)
    vi.mocked(db.listing.findUnique).mockResolvedValueOnce(null);

    const result = await approveListing("listing-1");

    expect(rateLimit).toHaveBeenCalledWith(
      "adminListingMod",
      expect.stringContaining("admin-1"),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Listing not found.");
    }
  });
});

// ── requestListingChanges ─────────────────────────────────────────────────────

describe("requestListingChanges — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue(RATE_ALLOWED_RESULT);
    vi.mocked(requirePermission).mockResolvedValue(ADMIN_1);
  });

  // Test 10
  it("returns RATE_LIMITED error when limit is exceeded", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce(RATE_LIMITED_RESULT);

    const result = await requestListingChanges(
      "listing-1",
      "Please add more photos.",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many requests/i);
    }
    expect(db.listing.findUnique).not.toHaveBeenCalled();
  });
});

// ── rejectListing ─────────────────────────────────────────────────────────────

describe("rejectListing — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue(RATE_ALLOWED_RESULT);
    vi.mocked(requirePermission).mockResolvedValue(ADMIN_1);
  });

  // Test 11
  it("returns RATE_LIMITED error when limit is exceeded", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce(RATE_LIMITED_RESULT);

    const result = await rejectListing("listing-1", "Prohibited item.");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many requests/i);
    }
    expect(db.listing.findUnique).not.toHaveBeenCalled();
  });
});

// ── Rate limit isolation between admins ───────────────────────────────────────

describe("rate limit isolation — different admins have independent counters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.update).mockResolvedValue({} as never);
  });

  // Test 12
  it("admin-1 being rate limited does not block admin-2", async () => {
    // Admin 1 — rate limited
    vi.mocked(requireAdmin).mockResolvedValueOnce({ userId: ADMIN_1.id });
    vi.mocked(rateLimit).mockResolvedValueOnce(RATE_LIMITED_RESULT);
    const blockedResult = await approveIdVerification("user-1");

    // Admin 2 — within limit
    vi.mocked(requireAdmin).mockResolvedValueOnce({ userId: ADMIN_2.id });
    vi.mocked(rateLimit).mockResolvedValueOnce(RATE_ALLOWED_RESULT);
    vi.mocked(userRepository.findForIdApproval).mockResolvedValueOnce(
      mockTargetUser as never,
    );
    const allowedResult = await approveIdVerification("user-1");

    expect(blockedResult.success).toBe(false);
    expect(allowedResult.success).toBe(true);

    // Verify each call used the correct admin ID in the key
    const calls = vi.mocked(rateLimit).mock.calls;
    expect(calls[0]![1]).toContain(ADMIN_1.id);
    expect(calls[1]![1]).toContain(ADMIN_2.id);
    // Keys must be different
    expect(calls[0]![1]).not.toBe(calls[1]![1]);
  });

  // Test 13
  it("allows action after rate limit window resets", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ userId: ADMIN_1.id });

    // First call: limit exhausted
    vi.mocked(rateLimit).mockResolvedValueOnce(RATE_LIMITED_RESULT);
    const firstResult = await approveIdVerification("user-1");
    expect(firstResult.success).toBe(false);

    // Window resets — subsequent call succeeds
    vi.mocked(rateLimit).mockResolvedValueOnce({
      ...RATE_ALLOWED_RESULT,
      remaining: 20, // full window
    });
    vi.mocked(userRepository.findForIdApproval).mockResolvedValueOnce(
      mockTargetUser as never,
    );
    const afterResetResult = await approveIdVerification("user-1");
    expect(afterResetResult.success).toBe(true);
  });
});
