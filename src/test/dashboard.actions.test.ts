// src/test/dashboard.actions.test.ts
// ─── Tests: Dashboard Server Actions ────────────────────────────────────────
// Covers fetchBuyerDashboard and fetchSellerDashboard — both thin wrappers
// around dashboardService with auth gate + service result envelope translation.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

const mockFetchBuyerDashboard = vi.fn();
const mockFetchSellerDashboard = vi.fn();
vi.mock("@/modules/dashboard/dashboard.service", () => ({
  dashboardService: {
    fetchBuyerDashboard: (...args: unknown[]) =>
      mockFetchBuyerDashboard(...args),
    fetchSellerDashboard: (...args: unknown[]) =>
      mockFetchSellerDashboard(...args),
  },
}));

const { fetchBuyerDashboard, fetchSellerDashboard } =
  await import("@/server/actions/dashboard");

const TEST_USER = { id: "user_dash", email: "d@test.com", isAdmin: false };

// ─────────────────────────────────────────────────────────────────────────────
// fetchBuyerDashboard
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchBuyerDashboard", () => {
  const okPayload = {
    user: { id: TEST_USER.id, displayName: "Buyer" },
    orders: [],
    watchlist: [],
    threads: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockFetchBuyerDashboard.mockResolvedValue({ ok: true, data: okPayload });
  });

  it("unauthenticated → returns sign-in error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await fetchBuyerDashboard();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/sign in/i);
    }
    expect(mockFetchBuyerDashboard).not.toHaveBeenCalled();
  });

  it("happy path → returns service data unchanged", async () => {
    const result = await fetchBuyerDashboard();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(okPayload);
    }
  });

  it("service returns ok:false → propagates service error", async () => {
    mockFetchBuyerDashboard.mockResolvedValueOnce({
      ok: false,
      error: "Dashboard temporarily unavailable.",
    });

    const result = await fetchBuyerDashboard();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Dashboard temporarily unavailable.");
    }
  });

  it("service throws → returns safe fallback error", async () => {
    mockFetchBuyerDashboard.mockRejectedValueOnce(new Error("Prisma boom"));

    const result = await fetchBuyerDashboard();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toMatch(/Prisma boom/);
    }
  });

  it("scopes service call to authenticated user id", async () => {
    await fetchBuyerDashboard();

    expect(mockFetchBuyerDashboard).toHaveBeenCalledWith(TEST_USER.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchSellerDashboard
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchSellerDashboard", () => {
  const okPayload = {
    user: { id: TEST_USER.id, displayName: "Seller" },
    stats: { totalSales: 0 },
    listings: [],
    orders: [],
    payouts: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockFetchSellerDashboard.mockResolvedValue({ ok: true, data: okPayload });
  });

  it("unauthenticated → returns sign-in error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await fetchSellerDashboard();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/sign in/i);
    }
    expect(mockFetchSellerDashboard).not.toHaveBeenCalled();
  });

  it("happy path → returns service data unchanged", async () => {
    const result = await fetchSellerDashboard();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(okPayload);
    }
  });

  it("service returns ok:false → propagates service error", async () => {
    mockFetchSellerDashboard.mockResolvedValueOnce({
      ok: false,
      error: "You need an active Stripe onboarding to continue.",
    });

    const result = await fetchSellerDashboard();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/stripe onboarding/i);
    }
  });

  it("service throws → returns safe fallback", async () => {
    mockFetchSellerDashboard.mockRejectedValueOnce(
      new Error("ECONNREFUSED 127.0.0.1"),
    );

    const result = await fetchSellerDashboard();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toMatch(/ECONNREFUSED/);
    }
  });

  it("scopes service call to authenticated user id", async () => {
    await fetchSellerDashboard();

    expect(mockFetchSellerDashboard).toHaveBeenCalledWith(TEST_USER.id);
  });
});
