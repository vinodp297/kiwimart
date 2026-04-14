// src/test/blocks.actions.test.ts
// ─── Tests: blocks.ts (blockUser, unblockUser) ───────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn().mockResolvedValue({
  id: "user_requester",
  email: "requester@test.com",
  isAdmin: false,
});
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock userRepository ───────────────────────────────────────────────────────
const mockFindBasicProfile = vi.fn().mockResolvedValue({
  id: "user_target",
  displayName: "Target User",
  username: "targetuser",
});
const mockUpsertBlock = vi.fn().mockResolvedValue(undefined);
const mockRemoveBlock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findBasicProfile: (...args: unknown[]) => mockFindBasicProfile(...args),
    upsertBlock: (...args: unknown[]) => mockUpsertBlock(...args),
    removeBlock: (...args: unknown[]) => mockRemoveBlock(...args),
    findEmailVerified: vi
      .fn()
      .mockResolvedValue({ emailVerified: new Date("2025-01-01") }),
  },
}));

const { blockUser, unblockUser } = await import("@/server/actions/blocks");

// ─────────────────────────────────────────────────────────────────────────────
// blockUser
// ─────────────────────────────────────────────────────────────────────────────

describe("blockUser — auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_requester",
      email: "requester@test.com",
    });
    mockFindBasicProfile.mockResolvedValue({
      id: "user_target",
      displayName: "Target User",
    });
  });

  it("unauthenticated → returns auth error, repo not called", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Please sign in"));

    const result = await blockUser("user_target");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockUpsertBlock).not.toHaveBeenCalled();
  });
});

describe("blockUser — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_requester",
      email: "requester@test.com",
    });
    mockFindBasicProfile.mockResolvedValue({
      id: "user_target",
      displayName: "Target User",
    });
  });

  it("cannot block yourself → error", async () => {
    const result = await blockUser("user_requester");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/yourself/i);
    expect(mockUpsertBlock).not.toHaveBeenCalled();
  });

  it("target user not found → error", async () => {
    mockFindBasicProfile.mockResolvedValueOnce(null);

    const result = await blockUser("nonexistent_user");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not found/i);
    expect(mockUpsertBlock).not.toHaveBeenCalled();
  });
});

describe("blockUser — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_requester",
      email: "requester@test.com",
    });
    mockFindBasicProfile.mockResolvedValue({
      id: "user_target",
      displayName: "Target User",
    });
    mockUpsertBlock.mockResolvedValue(undefined);
  });

  it("valid block → calls upsertBlock with correct args", async () => {
    const result = await blockUser("user_target");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.message).toContain("Target User");
    expect(mockUpsertBlock).toHaveBeenCalledWith(
      "user_requester",
      "user_target",
    );
  });

  it("block response includes target display name", async () => {
    mockFindBasicProfile.mockResolvedValue({
      id: "user_target",
      displayName: "Alice Smith",
    });

    const result = await blockUser("user_target");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.message).toContain("Alice Smith");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// unblockUser
// ─────────────────────────────────────────────────────────────────────────────

describe("unblockUser — auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_requester",
      email: "requester@test.com",
    });
    mockRemoveBlock.mockResolvedValue(undefined);
  });

  it("unauthenticated → returns auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Please sign in"));

    const result = await unblockUser("user_target");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockRemoveBlock).not.toHaveBeenCalled();
  });
});

describe("unblockUser — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_requester",
      email: "requester@test.com",
    });
    mockRemoveBlock.mockResolvedValue(undefined);
  });

  it("valid unblock → calls removeBlock with correct args", async () => {
    const result = await unblockUser("user_target");

    expect(result.success).toBe(true);
    expect(mockRemoveBlock).toHaveBeenCalledWith(
      "user_requester",
      "user_target",
    );
  });
});

describe("unblockUser — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_requester",
      email: "requester@test.com",
    });
  });

  it("removeBlock throws → error propagates (no outer try/catch in unblockUser)", async () => {
    mockRemoveBlock.mockRejectedValueOnce(new Error("DB error"));

    // unblockUser wraps requireUser in try/catch but removeBlock is outside it,
    // so a DB error will propagate as an uncaught rejection.
    await expect(unblockUser("user_target")).rejects.toThrow("DB error");
  });
});
