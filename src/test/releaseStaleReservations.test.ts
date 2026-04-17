// src/test/releaseStaleReservations.test.ts
// ─── Tests: Stale Listing Reservation Release Cron ──────────────────────────
// Covers releaseStaleReservations: distributed lock, listing repo delegation,
// idempotent return shape, logger audit.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock listing repository ──────────────────────────────────────────────────
const mockReleaseStaleReservations = vi.fn();
vi.mock("@/modules/listings/listing.repository", () => ({
  listingRepository: {
    releaseStaleReservations: (...args: unknown[]) =>
      mockReleaseStaleReservations(...args),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { releaseStaleReservations } =
  await import("@/server/jobs/releaseStaleReservations");
const { logger } = await import("@/shared/logger");
const { acquireLock, releaseLock } =
  await import("@/server/lib/distributedLock");

// ─────────────────────────────────────────────────────────────────────────────

describe("releaseStaleReservations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(acquireLock).mockResolvedValue("lock_value");
    vi.mocked(releaseLock).mockResolvedValue(undefined);
    mockReleaseStaleReservations.mockResolvedValue({ count: 0 });
  });

  it("skips when another instance already holds the lock", async () => {
    vi.mocked(acquireLock).mockResolvedValueOnce(null);

    const result = await releaseStaleReservations();

    expect(result).toEqual({ released: 0, skipped: true });
    expect(logger.info).toHaveBeenCalledWith(
      "release_stale_reservations.skipped_lock_held",
      expect.any(Object),
    );
    expect(mockReleaseStaleReservations).not.toHaveBeenCalled();
  });

  it("happy path → returns number released from repository", async () => {
    mockReleaseStaleReservations.mockResolvedValueOnce({ count: 3 });

    const result = await releaseStaleReservations();

    expect(result).toEqual({ released: 3 });
    expect(mockReleaseStaleReservations).toHaveBeenCalledTimes(1);
  });

  it("idempotent when nothing expired → returns { released: 0 }", async () => {
    mockReleaseStaleReservations.mockResolvedValueOnce({ count: 0 });

    const result = await releaseStaleReservations();

    expect(result).toEqual({ released: 0 });
    expect(logger.info).toHaveBeenCalledWith(
      "release_stale_reservations.completed",
      expect.objectContaining({ released: 0 }),
    );
  });

  it("passes the current Date to the repository", async () => {
    const before = Date.now();

    await releaseStaleReservations();

    const calledWith = mockReleaseStaleReservations.mock.calls[0]?.[0] as Date;
    expect(calledWith).toBeInstanceOf(Date);
    expect(calledWith.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(calledWith.getTime()).toBeLessThanOrEqual(before + 1000);
  });

  it("releases lock even when repo throws", async () => {
    mockReleaseStaleReservations.mockRejectedValueOnce(new Error("DB down"));

    await expect(releaseStaleReservations()).rejects.toThrow();
    expect(releaseLock).toHaveBeenCalled();
  });

  it("logs completion with released count", async () => {
    mockReleaseStaleReservations.mockResolvedValueOnce({ count: 7 });

    await releaseStaleReservations();

    expect(logger.info).toHaveBeenCalledWith(
      "release_stale_reservations.completed",
      expect.objectContaining({ released: 7 }),
    );
  });
});
