// src/test/reports.actions.test.ts
// ─── Tests: Report Server Actions ───────────────────────────────────────────
// Covers createReport:
//   auth gate, validation (Zod + targeting), self-report guard, listing lookup,
//   duplicate detection, moderation call, audit log, happy path

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock report repository ────────────────────────────────────────────────────
const mockFindListingSellerId = vi.fn();
const mockFindRecentByReporter = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/modules/listings/report.repository", () => ({
  reportRepository: {
    findListingSellerId: (...args: unknown[]) =>
      mockFindListingSellerId(...args),
    findRecentByReporter: (...args: unknown[]) =>
      mockFindRecentByReporter(...args),
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { createReport } = await import("@/server/actions/reports");
const { audit } = await import("@/server/lib/audit");
const { moderateText } = await import("@/server/lib/moderation");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_REPORTER = {
  id: "user_reporter",
  email: "r@test.com",
  isAdmin: false,
};

const validListingReport = {
  listingId: "listing_1",
  reason: "COUNTERFEIT" as const,
  description: "This listing appears to be a counterfeit item.",
};

const validUserReport = {
  targetUserId: "user_target",
  reason: "SPAM" as const,
  description: "This user has been spamming messages repeatedly.",
};

// ─────────────────────────────────────────────────────────────────────────────
// createReport
// ─────────────────────────────────────────────────────────────────────────────

describe("createReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_REPORTER);
    mockFindListingSellerId.mockResolvedValue({ sellerId: "user_target" });
    mockFindRecentByReporter.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "report_1" });
    vi.mocked(moderateText).mockReturnValue({
      allowed: true,
      flagged: false,
    } as never);
  });

  it("unauthenticated → returns Sign in error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await createReport(validListingReport);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/sign in/i);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("invalid input (reason enum) → returns validation error with fieldErrors", async () => {
    const result = await createReport({
      ...validListingReport,
      reason: "INVALID_REASON" as unknown as "SCAM",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid report/i);
      expect(result.fieldErrors).toBeDefined();
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("invalid input (description too short) → returns validation error", async () => {
    const result = await createReport({
      ...validListingReport,
      description: "short",
    });

    expect(result.success).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("missing both targetUserId and listingId → returns targeting error", async () => {
    const result = await createReport({
      reason: "SCAM",
      description: "This is a scam report without any target specified.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/specify what/i);
    }
  });

  it("reporting yourself via targetUserId → rejects", async () => {
    const result = await createReport({
      targetUserId: TEST_REPORTER.id,
      reason: "SPAM",
      description: "Trying to report my own account for fun only.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/cannot report yourself/i);
    }
  });

  it("listing not found → returns Listing not found error", async () => {
    mockFindListingSellerId.mockResolvedValueOnce(null);

    const result = await createReport(validListingReport);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/listing not found/i);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("reporting your own listing → rejects", async () => {
    mockFindListingSellerId.mockResolvedValueOnce({
      sellerId: TEST_REPORTER.id,
    });

    const result = await createReport(validListingReport);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/cannot report your own listing/i);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("duplicate report within 24h → returns dup message", async () => {
    mockFindRecentByReporter.mockResolvedValueOnce({ id: "report_existing" });

    const result = await createReport(validListingReport);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already reported/i);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("happy path (listing report) → creates report with resolved seller id", async () => {
    const result = await createReport(validListingReport);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reportId).toBe("report_1");
    }
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: TEST_REPORTER.id,
        targetUserId: "user_target", // Resolved from listing sellerId
        listingId: "listing_1",
        reason: "COUNTERFEIT",
        status: "OPEN",
      }),
    );
  });

  it("happy path (user report) → creates report with targetUserId directly", async () => {
    const result = await createReport(validUserReport);

    expect(result.success).toBe(true);
    // When targetUserId is provided, listing lookup is skipped
    expect(mockFindListingSellerId).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: "user_target",
        listingId: undefined,
      }),
    );
  });

  it("calls moderation service on description text", async () => {
    await createReport(validListingReport);

    expect(vi.mocked(moderateText)).toHaveBeenCalledWith(
      validListingReport.description,
      "report",
    );
  });

  it("writes an audit log entry on success", async () => {
    await createReport(validListingReport);

    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_REPORTER.id,
        action: "REPORT_CREATED",
        entityType: "Report",
        entityId: "report_1",
      }),
    );
  });

  it("queries duplicate check with listingId filter for listing reports", async () => {
    await createReport(validListingReport);

    expect(mockFindRecentByReporter).toHaveBeenCalledWith(
      TEST_REPORTER.id,
      { listingId: "listing_1" },
      expect.any(Date),
    );
  });

  it("queries duplicate check with targetUserId filter for user reports", async () => {
    await createReport(validUserReport);

    expect(mockFindRecentByReporter).toHaveBeenCalledWith(
      TEST_REPORTER.id,
      { targetUserId: "user_target" },
      expect.any(Date),
    );
  });
});
