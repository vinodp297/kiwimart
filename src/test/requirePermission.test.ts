// src/test/requirePermission.test.ts
// ─── Tests: admin permission guards ─────────────────────────────────────────
// Covers requireAnyAdmin, requirePermission, requireAnyPermission,
// requireSuperAdmin — including the no-session / no-user / banned / not-admin /
// missing-role / permission-denied branches.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock @/lib/permissions to control permission-check outcomes ──────────────
const mockHasPermission = vi.fn();
const mockHasAnyPermission = vi.fn();
vi.mock("@/lib/permissions", () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
  hasAnyPermission: (...args: unknown[]) => mockHasAnyPermission(...args),
}));

const { auth } = await import("@/lib/auth");
const db = (await import("@/lib/db")).default;
const {
  requireAnyAdmin,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} = await import("@/shared/auth/requirePermission");

const ADMIN_USER = {
  id: "admin_1",
  email: "admin@test.com",
  displayName: "Admin User",
  isAdmin: true,
  adminRole: "SUPPORT" as const,
  isBanned: false,
};
const SUPER_ADMIN = {
  ...ADMIN_USER,
  id: "super_1",
  adminRole: "SUPER_ADMIN" as const,
};

// ─────────────────────────────────────────────────────────────────────────────

describe("requireAnyAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin_1" },
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(ADMIN_USER as never);
  });

  it("throws when session is missing", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    await expect(requireAnyAdmin()).rejects.toThrow();
  });

  it("throws when session has no user.id", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: {} } as never);

    await expect(requireAnyAdmin()).rejects.toThrow();
  });

  it("throws when user not found in DB", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null as never);

    await expect(requireAnyAdmin()).rejects.toThrow();
  });

  it("throws when user is banned", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      ...ADMIN_USER,
      isBanned: true,
    } as never);

    await expect(requireAnyAdmin()).rejects.toThrow();
  });

  it("throws when isAdmin flag is false", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      ...ADMIN_USER,
      isAdmin: false,
    } as never);

    await expect(requireAnyAdmin()).rejects.toThrow();
  });

  it("throws when adminRole is null (admin flag set but no role)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      ...ADMIN_USER,
      adminRole: null,
    } as never);

    await expect(requireAnyAdmin()).rejects.toThrow();
  });

  it("happy path returns the admin user record", async () => {
    const result = await requireAnyAdmin();

    expect(result.id).toBe(ADMIN_USER.id);
    expect(result.adminRole).toBe("SUPPORT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("requirePermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin_1" },
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(ADMIN_USER as never);
  });

  it("returns admin when hasPermission is true", async () => {
    mockHasPermission.mockReturnValueOnce(true);

    const result = await requirePermission("admin.listings.moderate");

    expect(result.id).toBe(ADMIN_USER.id);
    expect(mockHasPermission).toHaveBeenCalledWith(
      "SUPPORT",
      "admin.listings.moderate",
    );
  });

  it("throws AppError (UNAUTHORISED) when permission denied", async () => {
    mockHasPermission.mockReturnValueOnce(false);

    await expect(requirePermission("admin.users.ban")).rejects.toThrow(
      /permission/i,
    );
  });

  it("forwards the admin role to hasPermission", async () => {
    mockHasPermission.mockReturnValueOnce(true);

    await requirePermission("admin.config.update");

    expect(mockHasPermission).toHaveBeenCalledWith(
      "SUPPORT",
      "admin.config.update",
    );
  });

  it("propagates upstream auth error (no session)", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    await expect(
      requirePermission("admin.listings.moderate"),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("requireAnyPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin_1" },
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(ADMIN_USER as never);
  });

  it("returns admin when hasAnyPermission is true", async () => {
    mockHasAnyPermission.mockReturnValueOnce(true);

    const result = await requireAnyPermission([
      "admin.listings.moderate",
      "admin.users.ban",
    ]);

    expect(result.id).toBe(ADMIN_USER.id);
    expect(mockHasAnyPermission).toHaveBeenCalledWith("SUPPORT", [
      "admin.listings.moderate",
      "admin.users.ban",
    ]);
  });

  it("throws when no permissions are held", async () => {
    mockHasAnyPermission.mockReturnValueOnce(false);

    await expect(
      requireAnyPermission(["admin.listings.moderate"]),
    ).rejects.toThrow(/permission/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("requireSuperAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "super_1" },
    } as never);
  });

  it("returns the super admin when role is SUPER_ADMIN", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(SUPER_ADMIN as never);

    const result = await requireSuperAdmin();

    expect(result.adminRole).toBe("SUPER_ADMIN");
  });

  it("throws when role is a lesser admin role", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(ADMIN_USER as never);

    await expect(requireSuperAdmin()).rejects.toThrow(/super admin/i);
  });

  it("throws when user is not admin at all", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      ...ADMIN_USER,
      isAdmin: false,
    } as never);

    await expect(requireSuperAdmin()).rejects.toThrow();
  });

  it("throws when user is banned", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      ...SUPER_ADMIN,
      isBanned: true,
    } as never);

    await expect(requireSuperAdmin()).rejects.toThrow();
  });
});
