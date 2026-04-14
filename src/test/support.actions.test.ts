// src/test/support.actions.test.ts
// ─── Tests: support.ts (lookupUser, lookupOrder) ─────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requirePermission ────────────────────────────────────────────────────
const mockRequirePermission = vi.fn().mockResolvedValue({
  id: "admin_1",
  email: "admin@test.com",
  isAdmin: true,
});
vi.mock("@/shared/auth/requirePermission", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

// ── Mock userRepository ───────────────────────────────────────────────────────
const mockFindForSupport = vi.fn().mockResolvedValue({
  id: "user_1",
  email: "user@test.com",
  displayName: "Test User",
});

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findForSupport: (...args: unknown[]) => mockFindForSupport(...args),
    findEmailVerified: vi
      .fn()
      .mockResolvedValue({ emailVerified: new Date("2025-01-01") }),
  },
}));

// ── Mock orderRepository ──────────────────────────────────────────────────────
const mockFindForSupportLookup = vi.fn().mockResolvedValue({
  id: "order_1",
  status: "COMPLETED",
  totalNzd: 5000,
});

vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findForSupportLookup: (...args: unknown[]) =>
      mockFindForSupportLookup(...args),
  },
}));

const { lookupUser, lookupOrder } = await import("@/server/actions/support");

// ─────────────────────────────────────────────────────────────────────────────
// lookupUser
// ─────────────────────────────────────────────────────────────────────────────

describe("lookupUser — permission guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue({ id: "admin_1" });
    mockFindForSupport.mockResolvedValue({
      id: "user_1",
      email: "user@test.com",
    });
  });

  it("no permission → throws, repo not called", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Forbidden"));

    await expect(lookupUser("user@test.com")).rejects.toThrow("Forbidden");
    expect(mockFindForSupport).not.toHaveBeenCalled();
  });

  it("requires VIEW_USER_PII permission", async () => {
    await lookupUser("user@test.com");

    expect(mockRequirePermission).toHaveBeenCalledWith("VIEW_USER_PII");
  });
});

describe("lookupUser — input handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue({ id: "admin_1" });
    mockFindForSupport.mockResolvedValue({ id: "user_1" });
  });

  it("empty query → returns null without calling repo", async () => {
    const result = await lookupUser("");

    expect(result).toBeNull();
    expect(mockFindForSupport).not.toHaveBeenCalled();
  });

  it("whitespace-only query → returns null", async () => {
    const result = await lookupUser("   ");

    expect(result).toBeNull();
    expect(mockFindForSupport).not.toHaveBeenCalled();
  });

  it("valid query → calls findForSupport with trimmed query", async () => {
    const result = await lookupUser("  user@test.com  ");

    expect(result).toBeTruthy();
    expect(mockFindForSupport).toHaveBeenCalledWith("user@test.com");
  });

  it("user not found → returns null from repo", async () => {
    mockFindForSupport.mockResolvedValueOnce(null);

    const result = await lookupUser("nobody@test.com");

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lookupOrder
// ─────────────────────────────────────────────────────────────────────────────

describe("lookupOrder — permission guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue({ id: "admin_1" });
    mockFindForSupportLookup.mockResolvedValue({ id: "order_1" });
  });

  it("no permission → throws, repo not called", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Forbidden"));

    await expect(lookupOrder("order_1")).rejects.toThrow("Forbidden");
    expect(mockFindForSupportLookup).not.toHaveBeenCalled();
  });

  it("requires VIEW_ORDER_DETAILS permission", async () => {
    await lookupOrder("order_1");

    expect(mockRequirePermission).toHaveBeenCalledWith("VIEW_ORDER_DETAILS");
  });
});

describe("lookupOrder — input handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue({ id: "admin_1" });
    mockFindForSupportLookup.mockResolvedValue({ id: "order_1" });
  });

  it("empty orderId → returns null without calling repo", async () => {
    const result = await lookupOrder("");

    expect(result).toBeNull();
    expect(mockFindForSupportLookup).not.toHaveBeenCalled();
  });

  it("whitespace orderId → returns null", async () => {
    const result = await lookupOrder("   ");

    expect(result).toBeNull();
    expect(mockFindForSupportLookup).not.toHaveBeenCalled();
  });

  it("valid orderId → calls findForSupportLookup with the provided value", async () => {
    const result = await lookupOrder("order_abc");

    expect(result).toBeTruthy();
    expect(mockFindForSupportLookup).toHaveBeenCalledWith("order_abc");
  });

  it("order not found → returns null from repo", async () => {
    mockFindForSupportLookup.mockResolvedValueOnce(null);

    const result = await lookupOrder("nonexistent");

    expect(result).toBeNull();
  });
});
