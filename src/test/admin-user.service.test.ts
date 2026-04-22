// src/test/admin-user.service.test.ts
// ─── Coverage tests: adminUserService methods not covered elsewhere ────────────
// Targets: flagUserForFraud, getUserAdminInfo, getTeamMembers, getModerationData,
// findAdminInvitation, grantAdminRoleFromInvite (lines 112–179 of the service).

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Admin repository mock ─────────────────────────────────────────────────────

const mockFlagUserForFraud = vi.fn().mockResolvedValue(undefined);
const mockFindUserAdminInfo = vi.fn().mockResolvedValue(null);
const mockFindAdminTeamMembers = vi.fn().mockResolvedValue([]);
const mockFindOpenReportsForModeration = vi.fn().mockResolvedValue([]);
const mockCountResolvedReports = vi.fn().mockResolvedValue(0);
const mockFindBannedUsers = vi.fn().mockResolvedValue([]);
const mockFindAdminInvitationByTokenHash = vi.fn().mockResolvedValue(null);
const mockGrantAdminRoleFromInvite = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/admin/admin.repository", () => ({
  adminRepository: {
    flagUserForFraud: (...a: unknown[]) => mockFlagUserForFraud(...a),
    findUserAdminInfo: (...a: unknown[]) => mockFindUserAdminInfo(...a),
    findAdminTeamMembers: () => mockFindAdminTeamMembers(),
    findOpenReportsForModeration: (...a: unknown[]) =>
      mockFindOpenReportsForModeration(...a),
    countResolvedReports: (...a: unknown[]) => mockCountResolvedReports(...a),
    findBannedUsers: (...a: unknown[]) => mockFindBannedUsers(...a),
    findAdminInvitationByTokenHash: (...a: unknown[]) =>
      mockFindAdminInvitationByTokenHash(...a),
    grantAdminRoleFromInvite: (...a: unknown[]) =>
      mockGrantAdminRoleFromInvite(...a),
    // Satisfy the resolveReport path even though it is not called in these tests
    findReportById: vi.fn().mockResolvedValue(null),
    resolveReport: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Order event service mock ──────────────────────────────────────────────────
// importOriginal preserves ORDER_EVENT_TYPES and ACTOR_ROLES constants so
// assertions can reference them directly without hard-coding string literals.

const mockRecordEvent = vi.fn();

vi.mock("@/modules/orders/order-event.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/modules/orders/order-event.service")
    >();
  return {
    ...actual,
    orderEventService: {
      ...actual.orderEventService,
      recordEvent: (...a: unknown[]) => mockRecordEvent(...a),
    },
  };
});

// ── Lazy imports ──────────────────────────────────────────────────────────────

const { adminUserService } = await import("@/modules/admin/admin-user.service");
const { audit } = await import("@/server/lib/audit");
const { ORDER_EVENT_TYPES, ACTOR_ROLES } =
  await import("@/modules/orders/order-event.service");

// ─────────────────────────────────────────────────────────────────────────────

describe("adminUserService — supplementary coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlagUserForFraud.mockResolvedValue(undefined);
    mockFindUserAdminInfo.mockResolvedValue(null);
    mockFindAdminTeamMembers.mockResolvedValue([]);
    mockFindOpenReportsForModeration.mockResolvedValue([]);
    mockCountResolvedReports.mockResolvedValue(0);
    mockFindBannedUsers.mockResolvedValue([]);
    mockFindAdminInvitationByTokenHash.mockResolvedValue(null);
    mockGrantAdminRoleFromInvite.mockResolvedValue(undefined);
  });

  // ── flagUserForFraud ────────────────────────────────────────────────────────

  describe("flagUserForFraud", () => {
    it("flags user for fraud, records order event, and creates audit entry", async () => {
      await adminUserService.flagUserForFraud(
        "user-1",
        "order-1",
        "suspicious payment pattern",
        "admin-1",
      );

      expect(mockFlagUserForFraud).toHaveBeenCalledWith("user-1");

      expect(mockRecordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: "order-1",
          type: ORDER_EVENT_TYPES.FRAUD_FLAGGED,
          actorId: "admin-1",
          actorRole: ACTOR_ROLES.ADMIN,
          metadata: expect.objectContaining({
            flaggedUserId: "user-1",
            reason: "suspicious payment pattern",
          }),
        }),
      );

      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "FRAUD_FLAGGED",
          entityType: "User",
          entityId: "user-1",
          metadata: expect.objectContaining({
            orderId: "order-1",
            reason: "suspicious payment pattern",
          }),
        }),
      );
    });
  });

  // ── getUserAdminInfo ────────────────────────────────────────────────────────

  describe("getUserAdminInfo", () => {
    it("returns admin info for an existing user", async () => {
      const mockInfo = {
        id: "user-1",
        email: "user@test.com",
        isBanned: false,
        role: "SELLER",
      };
      mockFindUserAdminInfo.mockResolvedValue(mockInfo);

      const result = await adminUserService.getUserAdminInfo("user-1");

      expect(result).toEqual(mockInfo);
      expect(mockFindUserAdminInfo).toHaveBeenCalledWith("user-1");
    });

    it("returns null when user is not found", async () => {
      mockFindUserAdminInfo.mockResolvedValue(null);

      const result = await adminUserService.getUserAdminInfo("nonexistent");

      expect(result).toBeNull();
    });
  });

  // ── getTeamMembers ──────────────────────────────────────────────────────────

  describe("getTeamMembers", () => {
    it("returns all admin team members", async () => {
      const mockTeam = [
        { id: "admin-1", email: "admin@test.com", role: "ADMIN" },
        { id: "admin-2", email: "super@test.com", role: "SUPER_ADMIN" },
      ];
      mockFindAdminTeamMembers.mockResolvedValue(mockTeam);

      const result = await adminUserService.getTeamMembers();

      expect(result).toEqual(mockTeam);
      expect(mockFindAdminTeamMembers).toHaveBeenCalled();
    });

    it("returns an empty array when there are no team members", async () => {
      const result = await adminUserService.getTeamMembers();
      expect(result).toEqual([]);
    });
  });

  // ── getModerationData ───────────────────────────────────────────────────────

  describe("getModerationData", () => {
    it("returns open reports, today's resolved count, and banned users in parallel", async () => {
      const mockReports = [{ id: "report-1", targetUserId: "user-2" }];
      const mockBanned = [{ id: "user-3", isBanned: true }];
      mockFindOpenReportsForModeration.mockResolvedValue(mockReports);
      mockCountResolvedReports.mockResolvedValue(7);
      mockFindBannedUsers.mockResolvedValue(mockBanned);

      const result = await adminUserService.getModerationData();

      expect(result).toEqual({
        reports: mockReports,
        resolvedToday: 7,
        bannedUsers: mockBanned,
      });
      // Verify query limits match the service constants (50 open, 20 banned)
      expect(mockFindOpenReportsForModeration).toHaveBeenCalledWith(50);
      expect(mockCountResolvedReports).toHaveBeenCalledWith(expect.any(Date));
      expect(mockFindBannedUsers).toHaveBeenCalledWith(20);
    });

    it("returns empty collections when there is nothing to moderate", async () => {
      const result = await adminUserService.getModerationData();

      expect(result).toEqual({
        reports: [],
        resolvedToday: 0,
        bannedUsers: [],
      });
    });
  });

  // ── findAdminInvitation ─────────────────────────────────────────────────────

  describe("findAdminInvitation", () => {
    it("returns invitation matching the provided token hash", async () => {
      const mockInvitation = {
        id: "inv-1",
        tokenHash: "hash-abc",
        role: "ADMIN",
      };
      mockFindAdminInvitationByTokenHash.mockResolvedValue(mockInvitation);

      const result = await adminUserService.findAdminInvitation("hash-abc");

      expect(result).toEqual(mockInvitation);
      expect(mockFindAdminInvitationByTokenHash).toHaveBeenCalledWith(
        "hash-abc",
      );
    });

    it("returns null when no invitation matches the token hash", async () => {
      const result = await adminUserService.findAdminInvitation("bad-hash");
      expect(result).toBeNull();
    });
  });

  // ── grantAdminRoleFromInvite ────────────────────────────────────────────────

  describe("grantAdminRoleFromInvite", () => {
    it("grants the specified admin role via the repository", async () => {
      await adminUserService.grantAdminRoleFromInvite(
        "user-1",
        "inv-1",
        "ADMIN",
      );

      expect(mockGrantAdminRoleFromInvite).toHaveBeenCalledWith(
        "user-1",
        "inv-1",
        "ADMIN",
      );
    });

    it("passes SUPER_ADMIN role through correctly", async () => {
      await adminUserService.grantAdminRoleFromInvite(
        "user-2",
        "inv-2",
        "SUPER_ADMIN",
      );

      expect(mockGrantAdminRoleFromInvite).toHaveBeenCalledWith(
        "user-2",
        "inv-2",
        "SUPER_ADMIN",
      );
    });
  });
});
