// src/test/dailyDigest.test.ts
// ─── Tests: Daily Digest Cron Job ────────────────────────────────────────────
// Covers sendDailyDigest: distributed lock, metrics fetch, super-admin dispatch,
// email client guard, skip conditions, logger audit.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock @/env ──────────────────────────────────────────────────────────────
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://kiwi.example.com",
    NEXT_PUBLIC_APP_NAME: "Kiwi Cart",
    EMAIL_FROM: "team@kiwi.example.com",
  },
}));

// ── Mock admin repository ────────────────────────────────────────────────────
const mockGetDailyDigestMetrics = vi.fn();
const mockFindSuperAdmins = vi.fn();
vi.mock("@/modules/admin/admin.repository", () => ({
  adminRepository: {
    getDailyDigestMetrics: (...args: unknown[]) =>
      mockGetDailyDigestMetrics(...args),
    findSuperAdmins: (...args: unknown[]) => mockFindSuperAdmins(...args),
  },
}));

// ── Mock email client ────────────────────────────────────────────────────────
const mockResendSend = vi.fn().mockResolvedValue({ id: "email_1" });
const mockGetEmailClient = vi.fn(() => ({
  emails: { send: mockResendSend },
}));
vi.mock("@/infrastructure/email/client", () => ({
  getEmailClient: () => mockGetEmailClient(),
  EMAIL_FROM: "team@kiwi.example.com",
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { sendDailyDigest } = await import("@/server/jobs/dailyDigest");
const { logger } = await import("@/shared/logger");
const { acquireLock, releaseLock } =
  await import("@/server/lib/distributedLock");

// ── Fixtures ──────────────────────────────────────────────────────────────────
const DEFAULT_METRICS = {
  newUsers: 5,
  newOrders: 12,
  completedOrders: 8,
  newDisputes: 1,
  gmvTotalNzd: 150_000, // $1,500.00
  newSellers: 2,
};

const SUPER_ADMINS = [
  { id: "admin_1", email: "a1@test.com" },
  { id: "admin_2", email: "a2@test.com" },
];

// ─────────────────────────────────────────────────────────────────────────────

describe("sendDailyDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(acquireLock).mockResolvedValue("lock_value");
    vi.mocked(releaseLock).mockResolvedValue(undefined);
    mockGetDailyDigestMetrics.mockResolvedValue(DEFAULT_METRICS);
    mockFindSuperAdmins.mockResolvedValue(SUPER_ADMINS);
    mockGetEmailClient.mockReturnValue({ emails: { send: mockResendSend } });
    mockResendSend.mockResolvedValue({ id: "email_1" });
  });

  it("skips when another instance already holds the lock", async () => {
    vi.mocked(acquireLock).mockResolvedValueOnce(null);

    await sendDailyDigest();

    expect(logger.info).toHaveBeenCalledWith(
      "daily_digest.skipped_lock_held",
      expect.any(Object),
    );
    expect(mockGetDailyDigestMetrics).not.toHaveBeenCalled();
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("happy path → sends one email per super admin", async () => {
    await sendDailyDigest();

    expect(mockResendSend).toHaveBeenCalledTimes(SUPER_ADMINS.length);
    expect(mockResendSend).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ to: "a1@test.com" }),
    );
    expect(mockResendSend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: "a2@test.com" }),
    );
  });

  it("no super admins → skips send and logs reason", async () => {
    mockFindSuperAdmins.mockResolvedValueOnce([]);

    await sendDailyDigest();

    expect(logger.warn).toHaveBeenCalledWith(
      "daily_digest.skipped",
      expect.objectContaining({ reason: "no_super_admins" }),
    );
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("no email client configured → skips send and logs reason", async () => {
    mockGetEmailClient.mockReturnValueOnce(null as never);

    await sendDailyDigest();

    expect(logger.warn).toHaveBeenCalledWith(
      "daily_digest.skipped",
      expect.objectContaining({ reason: "email_not_configured" }),
    );
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("queries metrics for the previous 24 hours", async () => {
    const before = Date.now();

    await sendDailyDigest();

    expect(mockGetDailyDigestMetrics).toHaveBeenCalledTimes(1);
    const since = mockGetDailyDigestMetrics.mock.calls[0]?.[0] as Date;
    // within [before - 24h - 5s, before - 24h + 5s]
    expect(since.getTime()).toBeGreaterThanOrEqual(
      before - 24 * 60 * 60 * 1000 - 5000,
    );
    expect(since.getTime()).toBeLessThanOrEqual(
      before - 24 * 60 * 60 * 1000 + 5000,
    );
  });

  it("email body includes formatted GMV and metric values", async () => {
    await sendDailyDigest();

    const emailCall = mockResendSend.mock.calls[0]?.[0] as {
      html: string;
      subject: string;
    };
    // GMV = 150000 cents → $1,500.00
    expect(emailCall.html).toMatch(/\$1,500\.00/);
    expect(emailCall.html).toContain("5"); // new users
    expect(emailCall.html).toContain("8"); // completed orders
    expect(emailCall.subject).toMatch(/Kiwi Cart Daily Summary/);
  });

  it("logs completion with recipient count and metrics", async () => {
    await sendDailyDigest();

    expect(logger.info).toHaveBeenCalledWith(
      "daily_digest.sent",
      expect.objectContaining({
        recipientCount: SUPER_ADMINS.length,
        gmv: DEFAULT_METRICS.gmvTotalNzd,
        newOrders: DEFAULT_METRICS.newOrders,
        completedOrders: DEFAULT_METRICS.completedOrders,
      }),
    );
  });

  it("always releases lock, even if metrics query throws", async () => {
    mockGetDailyDigestMetrics.mockRejectedValueOnce(new Error("DB down"));

    await expect(sendDailyDigest()).rejects.toThrow();
    expect(releaseLock).toHaveBeenCalled();
  });

  it("email with null address falls back to empty string", async () => {
    mockFindSuperAdmins.mockResolvedValueOnce([
      { id: "admin_no_email", email: null },
    ]);

    await sendDailyDigest();

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "" }),
    );
  });
});
