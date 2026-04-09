// src/test/metrics.test.ts
// ─── Tests: /api/metrics — DB-backed permission check ─────────────────────────
// Verifies that the metrics endpoint uses requirePermission() (DB-backed)
// rather than the stale session.user.isAdmin JWT claim.
//
// Tests:
//   1. Returns 403 without admin permission
//   2. Returns metrics with VIEW_ALL_METRICS permission
//   3. Revoked admin (isAdmin revoked at DB level) cannot access metrics

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockRequirePermission, mockGetBusinessMetrics } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
  mockGetBusinessMetrics: vi.fn(),
}));

vi.mock("@/shared/auth/requirePermission", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
  requireSuperAdmin: vi.fn(),
  requireAnyAdmin: vi.fn(),
}));

vi.mock("@/modules/admin/admin.service", () => ({
  adminService: {
    getBusinessMetrics: (...args: unknown[]) => mockGetBusinessMetrics(...args),
  },
}));

import { GET } from "@/app/api/metrics/route";

const ADMIN_USER = {
  id: "admin-metrics-test",
  email: "admin@buyzi.test",
  displayName: "Test Admin",
  isAdmin: true,
  adminRole: "SUPER_ADMIN" as const,
};

const MOCK_METRICS = {
  totalUsers: 100,
  totalOrders: 50,
  totalRevenue: 5000,
};

describe("/api/metrics — requirePermission guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBusinessMetrics.mockResolvedValue(MOCK_METRICS);
  });

  // Test 1 — Returns 403 without admin permission
  it("returns 403 when requirePermission throws (no permission)", async () => {
    mockRequirePermission.mockRejectedValue(new Error("UNAUTHORISED"));

    const res = await GET();
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.success).toBe(false);
  });

  // Test 2 — Returns metrics data with valid VIEW_ALL_METRICS permission
  it("returns metrics data when admin has VIEW_ALL_METRICS permission", async () => {
    mockRequirePermission.mockResolvedValue(ADMIN_USER);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(MOCK_METRICS);
  });

  // Test 2b — requirePermission is called with the correct permission
  it("calls requirePermission with VIEW_ALL_METRICS", async () => {
    mockRequirePermission.mockResolvedValue(ADMIN_USER);

    await GET();

    expect(mockRequirePermission).toHaveBeenCalledWith("VIEW_ALL_METRICS");
  });

  // Test 3 — Revoked admin cannot access metrics via stale JWT
  // When an admin's role is revoked in the DB, requirePermission throws.
  // The endpoint must 403, not rely on the JWT claim alone.
  it("returns 403 for a revoked admin (DB check fails even if JWT claims isAdmin)", async () => {
    // Simulate: admin role removed from DB — requirePermission throws despite
    // what the JWT might claim
    mockRequirePermission.mockRejectedValue(
      new Error("Your role does not have permission: VIEW_ALL_METRICS"),
    );

    const res = await GET();
    expect(res.status).toBe(403);

    // getBusinessMetrics must NOT have been called
    expect(mockGetBusinessMetrics).not.toHaveBeenCalled();
  });

  // Test 3b — Error from adminService does not leak to client
  it("returns 500 with generic message when metrics fetch fails", async () => {
    mockRequirePermission.mockResolvedValue(ADMIN_USER);
    mockGetBusinessMetrics.mockRejectedValue(new Error("DB connection failed"));

    const res = await GET();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.success).toBe(false);
    // Generic error message — no internal details leaked
    expect(body.error).not.toContain("DB connection");
  });
});
