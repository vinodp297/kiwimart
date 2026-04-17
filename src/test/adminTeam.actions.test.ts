// src/test/adminTeam.actions.test.ts
// ─── Tests: Admin Team Management Server Actions ────────────────────────────
// Covers inviteAdmin (super-admin gate, duplicate check, token hashing, email
// fire-and-forget), changeAdminRole and revokeAdminAccess (self-targeting guard).

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock @/env ──────────────────────────────────────────────────────────────
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://kiwi.example.com",
    NEXT_PUBLIC_APP_NAME: "Kiwi Cart",
    EMAIL_FROM: "team@kiwi.example.com",
  },
}));

// ── Mock requireSuperAdmin ───────────────────────────────────────────────────
const mockRequireSuperAdmin = vi.fn();
vi.mock("@/shared/auth/requirePermission", () => ({
  requireSuperAdmin: (...args: unknown[]) => mockRequireSuperAdmin(...args),
}));

// ── Mock admin-team repository ───────────────────────────────────────────────
const mockUpsertInvitation = vi.fn();
vi.mock("@/modules/admin/admin-team.repository", () => ({
  adminTeamRepository: {
    upsertInvitation: (...args: unknown[]) => mockUpsertInvitation(...args),
  },
}));

// ── Mock user repository ─────────────────────────────────────────────────────
const mockFindIsAdminByEmail = vi.fn();
const mockUserUpdate = vi.fn();
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findIsAdminByEmail: (...args: unknown[]) => mockFindIsAdminByEmail(...args),
    update: (...args: unknown[]) => mockUserUpdate(...args),
  },
}));

// ── Mock email client (Resend) ───────────────────────────────────────────────
const mockResendSend = vi.fn().mockResolvedValue({ id: "email_1" });
const mockGetEmailClient = vi.fn(() => ({
  emails: { send: mockResendSend },
}));
vi.mock("@/infrastructure/email/client", () => ({
  getEmailClient: () => mockGetEmailClient(),
  EMAIL_FROM: "team@kiwi.example.com",
}));

// ── Mock email transport helper ──────────────────────────────────────────────
vi.mock("@/server/email/transport", () => ({
  redactEmail: (e: string) => `r_${e}`,
}));

// ── Mock permissions helper ──────────────────────────────────────────────────
vi.mock("@/lib/permissions", () => ({
  getRoleDisplayName: (r: string) => `Role:${r}`,
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { inviteAdmin, changeAdminRole, revokeAdminAccess } =
  await import("@/server/actions/adminTeam");
const { logger } = await import("@/shared/logger");

// ── Fixtures ──────────────────────────────────────────────────────────────────
const SUPER_ADMIN = {
  id: "admin_super_1",
  email: "super@test.com",
  displayName: "Super Admin",
  isAdmin: true,
  adminRole: "SUPER_ADMIN",
};

// ─────────────────────────────────────────────────────────────────────────────
// inviteAdmin
// ─────────────────────────────────────────────────────────────────────────────

describe("inviteAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSuperAdmin.mockResolvedValue(SUPER_ADMIN);
    mockFindIsAdminByEmail.mockResolvedValue(null);
    mockUpsertInvitation.mockResolvedValue(undefined);
    mockGetEmailClient.mockReturnValue({
      emails: { send: mockResendSend },
    });
    mockResendSend.mockResolvedValue({ id: "email_1" });
  });

  it("non-super-admin → returns safe error and does not invite", async () => {
    mockRequireSuperAdmin.mockRejectedValueOnce(
      new Error("Super admin access required."),
    );

    const result = await inviteAdmin(
      "new@test.com",
      "TRUST_SAFETY_ADMIN" as never,
    );

    expect(result.success).toBe(false);
    expect(mockUpsertInvitation).not.toHaveBeenCalled();
  });

  it("email already belongs to an admin → returns already an admin error", async () => {
    mockFindIsAdminByEmail.mockResolvedValueOnce({ isAdmin: true });

    const result = await inviteAdmin(
      "existing@test.com",
      "TRUST_SAFETY_ADMIN" as never,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already an admin/i);
    }
    expect(mockUpsertInvitation).not.toHaveBeenCalled();
  });

  it("happy path → upserts invitation with token hash + 48h expiry", async () => {
    const before = Date.now();

    const result = await inviteAdmin(
      "new@test.com",
      "TRUST_SAFETY_ADMIN" as never,
    );

    expect(result.success).toBe(true);
    expect(mockUpsertInvitation).toHaveBeenCalledTimes(1);

    const params = mockUpsertInvitation.mock.calls[0]?.[0] as {
      email: string;
      adminRole: string;
      invitedById: string;
      tokenHash: string;
      expiresAt: Date;
    };
    expect(params.email).toBe("new@test.com");
    expect(params.adminRole).toBe("TRUST_SAFETY_ADMIN");
    expect(params.invitedById).toBe(SUPER_ADMIN.id);
    // SHA-256 hex hash is 64 chars
    expect(params.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    // expiresAt is ~48h in the future
    const fortyEightHoursMs = 48 * 60 * 60 * 1000;
    expect(params.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + fortyEightHoursMs - 5000,
    );
    expect(params.expiresAt.getTime()).toBeLessThanOrEqual(
      before + fortyEightHoursMs + 5000,
    );
  });

  it("stores hash, never the raw token", async () => {
    await inviteAdmin("new@test.com", "TRUST_SAFETY_ADMIN" as never);

    const params = mockUpsertInvitation.mock.calls[0]?.[0] as {
      tokenHash: string;
    };
    // Hex hash, never a plain token (no underscore / prefix / short string)
    expect(params.tokenHash.length).toBe(64);
    expect(params.tokenHash).not.toContain("invite");
  });

  it("each invocation uses a fresh random token (fresh hash each time)", async () => {
    await inviteAdmin("a@test.com", "TRUST_SAFETY_ADMIN" as never);
    await inviteAdmin("b@test.com", "TRUST_SAFETY_ADMIN" as never);

    const hash1 = (
      mockUpsertInvitation.mock.calls[0]?.[0] as { tokenHash: string }
    ).tokenHash;
    const hash2 = (
      mockUpsertInvitation.mock.calls[1]?.[0] as { tokenHash: string }
    ).tokenHash;
    expect(hash1).not.toBe(hash2);
  });

  it("repository throws → returns safe error (no leak)", async () => {
    mockUpsertInvitation.mockRejectedValueOnce(
      new Error("ECONNREFUSED 127.0.0.1:5432"),
    );

    const result = await inviteAdmin(
      "new@test.com",
      "TRUST_SAFETY_ADMIN" as never,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
    }
  });

  it("email failure does not break invite flow (fire-and-forget)", async () => {
    mockResendSend.mockRejectedValueOnce(new Error("SMTP down"));

    const result = await inviteAdmin(
      "new@test.com",
      "TRUST_SAFETY_ADMIN" as never,
    );

    // Invite still succeeds — email error is logged and swallowed
    expect(result.success).toBe(true);
  });

  it("no email client configured → skips email but succeeds", async () => {
    mockGetEmailClient.mockReturnValueOnce(null as never);

    const result = await inviteAdmin(
      "new@test.com",
      "TRUST_SAFETY_ADMIN" as never,
    );

    expect(result.success).toBe(true);
    expect(mockResendSend).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// changeAdminRole
// ─────────────────────────────────────────────────────────────────────────────

describe("changeAdminRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSuperAdmin.mockResolvedValue(SUPER_ADMIN);
    mockUserUpdate.mockResolvedValue({});
  });

  it("non-super-admin → returns safe error", async () => {
    mockRequireSuperAdmin.mockRejectedValueOnce(new Error("Nope"));

    const result = await changeAdminRole(
      "other_admin",
      "TRUST_SAFETY_ADMIN" as never,
    );

    expect(result.success).toBe(false);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("self-targeting → returns Cannot change your own role", async () => {
    const result = await changeAdminRole(
      SUPER_ADMIN.id,
      "TRUST_SAFETY_ADMIN" as never,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/your own role/i);
    }
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("happy path → updates role and logs event", async () => {
    const result = await changeAdminRole(
      "other_admin",
      "TRUST_SAFETY_ADMIN" as never,
    );

    expect(result.success).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith("other_admin", {
      adminRole: "TRUST_SAFETY_ADMIN",
    });
    expect(logger.info).toHaveBeenCalledWith(
      "admin.role.changed",
      expect.objectContaining({
        targetUserId: "other_admin",
        newRole: "TRUST_SAFETY_ADMIN",
        changedBy: SUPER_ADMIN.id,
      }),
    );
  });

  it("repository throws → returns safe error", async () => {
    mockUserUpdate.mockRejectedValueOnce(new Error("DB down"));

    const result = await changeAdminRole(
      "other_admin",
      "TRUST_SAFETY_ADMIN" as never,
    );

    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// revokeAdminAccess
// ─────────────────────────────────────────────────────────────────────────────

describe("revokeAdminAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSuperAdmin.mockResolvedValue(SUPER_ADMIN);
    mockUserUpdate.mockResolvedValue({});
  });

  it("non-super-admin → returns safe error", async () => {
    mockRequireSuperAdmin.mockRejectedValueOnce(new Error("Nope"));

    const result = await revokeAdminAccess("other_admin");

    expect(result.success).toBe(false);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("self-targeting → returns Cannot revoke your own admin access", async () => {
    const result = await revokeAdminAccess(SUPER_ADMIN.id);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/your own admin access/i);
    }
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("happy path → clears isAdmin and adminRole, logs event", async () => {
    const result = await revokeAdminAccess("other_admin");

    expect(result.success).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith("other_admin", {
      isAdmin: false,
      adminRole: null,
    });
    expect(logger.info).toHaveBeenCalledWith(
      "admin.access.revoked",
      expect.objectContaining({
        targetUserId: "other_admin",
        revokedBy: SUPER_ADMIN.id,
      }),
    );
  });

  it("repository throws → returns safe error", async () => {
    mockUserUpdate.mockRejectedValueOnce(new Error("DB down"));

    const result = await revokeAdminAccess("other_admin");

    expect(result.success).toBe(false);
  });

  it("does not leak raw db error strings", async () => {
    mockUserUpdate.mockRejectedValueOnce(
      new Error("ECONNREFUSED 127.0.0.1:5432"),
    );

    const result = await revokeAdminAccess("other_admin");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
    }
  });
});
