// src/test/watchlist.actions.test.ts
// ─── Tests: watchlist.ts (togglePriceAlert) ──────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn().mockResolvedValue({
  id: "user_buyer",
  email: "buyer@test.com",
  isAdmin: false,
});
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock watchlistRepository ──────────────────────────────────────────────────
const mockFindByUserAndListing = vi
  .fn()
  .mockResolvedValue({
    id: "watch_1",
    listingId: "listing_1",
    userId: "user_buyer",
  });
const mockUpdatePriceAlert = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/listings/watchlist.repository", () => ({
  watchlistRepository: {
    findByUserAndListing: (...args: unknown[]) =>
      mockFindByUserAndListing(...args),
    updatePriceAlert: (...args: unknown[]) => mockUpdatePriceAlert(...args),
  },
}));

const { togglePriceAlert } = await import("@/server/actions/watchlist");

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A — Auth guard
// ─────────────────────────────────────────────────────────────────────────────

describe("togglePriceAlert — auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
    mockFindByUserAndListing.mockResolvedValue({
      id: "watch_1",
      listingId: "listing_1",
    });
  });

  it("unauthenticated → returns auth error, repo not called", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Please sign in"));

    const result = await togglePriceAlert({
      listingId: "listing_1",
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockFindByUserAndListing).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B — Schema validation
// ─────────────────────────────────────────────────────────────────────────────

describe("togglePriceAlert — schema validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
  });

  it("empty listingId → validation error, repo not called", async () => {
    const result = await togglePriceAlert({ listingId: "", enabled: true });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockFindByUserAndListing).not.toHaveBeenCalled();
  });

  it("missing enabled field → validation error", async () => {
    const result = await togglePriceAlert({ listingId: "listing_1" });

    expect(result.success).toBe(false);
    expect(mockFindByUserAndListing).not.toHaveBeenCalled();
  });

  it("null input → validation error", async () => {
    const result = await togglePriceAlert(null);

    expect(result.success).toBe(false);
    expect(mockFindByUserAndListing).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C — Happy paths
// ─────────────────────────────────────────────────────────────────────────────

describe("togglePriceAlert — happy paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
    mockFindByUserAndListing.mockResolvedValue({
      id: "watch_1",
      listingId: "listing_1",
    });
    mockUpdatePriceAlert.mockResolvedValue(undefined);
  });

  it("enable price alert — returns success with enabled: true", async () => {
    const result = await togglePriceAlert({
      listingId: "listing_1",
      enabled: true,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ enabled: true });
    expect(mockFindByUserAndListing).toHaveBeenCalledWith(
      "user_buyer",
      "listing_1",
    );
    expect(mockUpdatePriceAlert).toHaveBeenCalledWith("watch_1", true);
  });

  it("disable price alert — returns success with enabled: false", async () => {
    const result = await togglePriceAlert({
      listingId: "listing_1",
      enabled: false,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ enabled: false });
    expect(mockUpdatePriceAlert).toHaveBeenCalledWith("watch_1", false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP D — Error handling
// ─────────────────────────────────────────────────────────────────────────────

describe("togglePriceAlert — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
  });

  it("item not in watchlist (findByUserAndListing returns null) → error", async () => {
    mockFindByUserAndListing.mockResolvedValueOnce(null);

    const result = await togglePriceAlert({
      listingId: "listing_not_watched",
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/watchlist/i);
    expect(mockUpdatePriceAlert).not.toHaveBeenCalled();
  });

  it("updatePriceAlert throws → action returns error without crashing", async () => {
    mockFindByUserAndListing.mockResolvedValue({ id: "watch_1" });
    mockUpdatePriceAlert.mockRejectedValueOnce(
      new Error("DB connection failed"),
    );

    const result = await togglePriceAlert({
      listingId: "listing_1",
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("action never throws — always returns ActionResult", async () => {
    mockFindByUserAndListing.mockRejectedValueOnce(new Error("Unexpected"));

    const result = await togglePriceAlert({
      listingId: "listing_1",
      enabled: true,
    });

    expect(result).toHaveProperty("success", false);
    expect(() => result).not.toThrow();
  });
});
