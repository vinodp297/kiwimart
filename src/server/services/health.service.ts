// src/server/services/health.service.ts
// ─── Health Service ──────────────────────────────────────────────────────────
// Thin wrapper around the database ping used by health-check routes.
// Keeps raw db access out of route files.

import db from "@/lib/db";

export interface BusinessMetrics {
  /** Payouts awaiting release (PENDING status). */
  pendingPayouts: number;
  /** Open disputes requiring admin attention. */
  openDisputes: number;
  /**
   * BullMQ DLQ job count across the critical queues.
   * null means the queue metrics were unavailable — never substitute 0,
   * as zero looks healthy when the real value is unknown.
   */
  failedJobs: number | null;
  /** ISO timestamp of the oldest PENDING payout, or null if none. */
  oldestPendingPayout: string | null;
  /**
   * true  — all metric sources responded; values are authoritative.
   * false — at least one source (BullMQ) was unavailable; treat failedJobs
   *         as unknown and surface "degraded" rather than "ok".
   */
  metricsAvailable: boolean;
}

export const healthService = {
  /** Run a lightweight DB query to confirm the database is reachable.
   * Throws on failure; callers wrap with try/catch or withTimeout. */
  async pingDatabase(): Promise<void> {
    await db.$queryRaw`SELECT 1`;
  },

  /**
   * Collect business-level health signals for SLO monitoring.
   * Returns counts that tell operators whether the business is healthy,
   * not just whether the infrastructure is running.
   *
   * - pendingPayouts: sellers waiting to be paid
   * - openDisputes: disputes awaiting human review
   * - failedJobs: DLQ size across BullMQ queues (null = unavailable)
   * - oldestPendingPayout: age of the oldest payout stuck in PENDING
   * - metricsAvailable: false when any metric source could not be reached
   */
  async getBusinessMetrics(): Promise<BusinessMetrics> {
    const [pendingPayouts, openDisputes, oldestPending] = await Promise.all([
      db.payout.count({ where: { status: "PENDING" } }),
      db.dispute.count({ where: { status: "OPEN" } }),
      db.payout.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

    // Failed-job count is collected lazily — BullMQ may not be connected in
    // some environments (build-time, unit tests). On failure we use null (not 0)
    // so callers can distinguish "zero failed jobs" from "count unavailable".
    let failedJobs: number | null = null;
    let metricsAvailable = true;
    try {
      const { QUEUE_MAP } = await import("@/lib/queue");
      const counts = await Promise.all(
        Object.values(QUEUE_MAP).map((q) => q.getJobCounts("failed")),
      );
      failedJobs = counts.reduce((sum, c) => sum + (c.failed ?? 0), 0);
    } catch {
      // Queue unavailable — null signals "unknown", not "zero".
      // The admin health endpoint surfaces this as "degraded".
      metricsAvailable = false;
    }

    return {
      pendingPayouts,
      openDisputes,
      failedJobs,
      oldestPendingPayout: oldestPending?.createdAt.toISOString() ?? null,
      metricsAvailable,
    };
  },
};
