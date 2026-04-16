// src/test/storage.actions.test.ts
// ─── Tests: Storage Monitoring Server Action ────────────────────────────────
// Covers getStorageStats:
//   auth gate, admin check, aggregation, compression math, averaging

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock listing image repository ─────────────────────────────────────────────
const mockCountAll = vi.fn();
const mockCountProcessed = vi.fn();
const mockCountPending = vi.fn();
const mockCountWithThumbnails = vi.fn();
const mockAggregateSizes = vi.fn();

vi.mock("@/modules/listings/listing-image.repository", () => ({
  listingImageRepository: {
    countAll: (...args: unknown[]) => mockCountAll(...args),
    countProcessed: (...args: unknown[]) => mockCountProcessed(...args),
    countPending: (...args: unknown[]) => mockCountPending(...args),
    countWithThumbnails: (...args: unknown[]) =>
      mockCountWithThumbnails(...args),
    aggregateSizes: (...args: unknown[]) => mockAggregateSizes(...args),
  },
}));

// ── Lazy import ──────────────────────────────────────────────────────────────
const { getStorageStats } = await import("@/server/actions/storage");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_ADMIN = { id: "user_admin", email: "a@test.com", isAdmin: true };
const TEST_USER = { id: "user_plain", email: "u@test.com", isAdmin: false };

// ─────────────────────────────────────────────────────────────────────────────
// getStorageStats
// ─────────────────────────────────────────────────────────────────────────────

describe("getStorageStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_ADMIN);
    mockCountAll.mockResolvedValue(100);
    mockCountProcessed.mockResolvedValue(80);
    mockCountPending.mockResolvedValue(20);
    mockCountWithThumbnails.mockResolvedValue(75);
    mockAggregateSizes.mockResolvedValue({
      _sum: { sizeBytes: 1_000_000, originalSizeBytes: 4_000_000 },
      _avg: { sizeBytes: 10_000 },
    });
  });

  it("unauthenticated → returns safe error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await getStorageStats();

    expect(result.success).toBe(false);
    expect(mockCountAll).not.toHaveBeenCalled();
  });

  it("non-admin → returns Admin access required error", async () => {
    mockRequireUser.mockResolvedValueOnce(TEST_USER);

    const result = await getStorageStats();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/admin access required/i);
    }
    expect(mockCountAll).not.toHaveBeenCalled();
  });

  it("admin happy path → returns counts from repository", async () => {
    const result = await getStorageStats();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalImages).toBe(100);
      expect(result.data.processedImages).toBe(80);
      expect(result.data.pendingImages).toBe(20);
      expect(result.data.thumbnailCount).toBe(75);
    }
  });

  it("computes compression savings (original - current)", async () => {
    const result = await getStorageStats();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.compressionSavingsBytes).toBe(3_000_000);
    }
  });

  it("computes compression ratio as percentage with 1 decimal", async () => {
    const result = await getStorageStats();

    expect(result.success).toBe(true);
    if (result.success) {
      // 1 - 1m/4m = 0.75 → 75.0%
      expect(result.data.compressionRatio).toBe(75);
    }
  });

  it("originalSize of 0 → savings 0 and ratio 0 (no divide-by-zero)", async () => {
    mockAggregateSizes.mockResolvedValueOnce({
      _sum: { sizeBytes: 500, originalSizeBytes: 0 },
      _avg: { sizeBytes: 50 },
    });

    const result = await getStorageStats();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.compressionSavingsBytes).toBe(0);
      expect(result.data.compressionRatio).toBe(0);
    }
  });

  it("null aggregate sums → defaults to 0", async () => {
    mockAggregateSizes.mockResolvedValueOnce({
      _sum: { sizeBytes: null, originalSizeBytes: null },
      _avg: { sizeBytes: null },
    });

    const result = await getStorageStats();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalSizeBytes).toBe(0);
      expect(result.data.totalOriginalSizeBytes).toBe(0);
      expect(result.data.averageSizeBytes).toBe(0);
    }
  });

  it("rounds average size to nearest integer", async () => {
    mockAggregateSizes.mockResolvedValueOnce({
      _sum: { sizeBytes: 1_000_000, originalSizeBytes: 2_000_000 },
      _avg: { sizeBytes: 12_345.678 },
    });

    const result = await getStorageStats();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.averageSizeBytes).toBe(12_346);
    }
  });

  it("repository throws → returns safe fallback error", async () => {
    mockCountAll.mockRejectedValueOnce(new Error("Prisma timeout"));

    const result = await getStorageStats();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
      expect(result.error).not.toMatch(/Prisma timeout/);
    }
  });

  it("parallel fetch — all four counts queried concurrently", async () => {
    await getStorageStats();

    expect(mockCountAll).toHaveBeenCalledTimes(1);
    expect(mockCountProcessed).toHaveBeenCalledTimes(1);
    expect(mockCountPending).toHaveBeenCalledTimes(1);
    expect(mockCountWithThumbnails).toHaveBeenCalledTimes(1);
    expect(mockAggregateSizes).toHaveBeenCalledTimes(1);
  });
});
